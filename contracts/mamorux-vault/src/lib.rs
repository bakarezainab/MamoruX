//! # MamoruVault
//!
//! On-chain half of **MamoruX**: a private AI-swarm dark pool with a security firewall.
//!
//! * Off-chain agents (Strategist / Sentinel / Matcher) run inside NEAR AI Cloud TEEs.
//!   Strategy details never touch the chain; only a `plan_hash` commitment and per-agent
//!   attestation report hashes are recorded here.
//! * The vault enforces a **policy firewall**: risk ceiling, multi-agent quorum, mandatory
//!   Sentinel (security) approval, chain allowlist, notional cap, and a circuit breaker.
//! * Approved native legs are signed through NEAR **Chain Signatures** (MPC signer), so the
//!   vault controls derived addresses on Bitcoin / EVM / Solana with no bridges.
//! * Residual legs are routed via **NEAR Intents** off-chain and settled back here by reference.

use near_sdk::serde_json::Value;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

/// Gas reserved for the `on_signed` callback.
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// Max legs per plan (keeps storage and gas bounded).
const MAX_LEGS: usize = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRole {
    /// Splits user intents into execution legs.
    Strategist,
    /// Security auditor: contract / liquidity / counterparty risk.
    Sentinel,
    /// Private netting engine: matches offsetting flow before it hits public venues.
    Matcher,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentInfo {
    pub role: AgentRole,
    /// sha256 (hex) of the agent's TEE attestation report from NEAR AI Cloud.
    pub tee_attestation_hash: String,
    pub registered_at_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    /// Plans with any attested risk score above this are rejected (0-100).
    pub max_risk_score: u8,
    /// Number of `Approve` attestations required (strategist submission counts as one).
    pub min_approvals: u8,
    /// At least one Sentinel must approve.
    pub require_sentinel: bool,
    /// Lower-case chain identifiers, e.g. `ethereum`, `bitcoin`, `solana`, `base`, `near`.
    pub allowed_chains: Vec<String>,
    /// Max total notional per plan, in whole USD.
    pub max_plan_notional_usd: u64,
    /// Circuit breaker.
    pub paused: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegKind {
    /// Routed through NEAR Intents (1Click / intents.near); settled by reference.
    Intent,
    /// Signed by the vault via Chain Signatures and broadcast to the destination chain.
    Native,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegStatus {
    Pending,
    Signing,
    Signed,
    Settled,
    Failed,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct LegInput {
    pub chain: String,
    pub kind: LegKind,
    /// For `Native` ECDSA chains: 32-byte tx hash (hex). For Solana: message bytes (hex).
    /// For `Intent`: optional 32-byte hex commitment of the intent quote.
    pub payload_hex: String,
    pub notional_usd: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Leg {
    pub chain: String,
    pub kind: LegKind,
    pub payload_hex: String,
    pub notional_usd: u64,
    pub status: LegStatus,
    /// Raw JSON signature returned by the MPC signer.
    pub signature: Option<String>,
    /// Destination-chain tx hash or NEAR Intents settlement reference.
    pub settlement_ref: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Approve,
    Reject,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attestation {
    pub agent: AccountId,
    pub role: AgentRole,
    pub risk_score: u8,
    pub verdict: Verdict,
    /// sha256 (hex) of the agent's private reasoning report (kept off-chain, in the TEE).
    pub report_hash: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanStatus {
    Pending,
    Approved,
    Rejected,
    Completed,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub id: u64,
    pub owner: AccountId,
    /// sha256 commitment of the full private plan.
    pub plan_hash: String,
    pub legs: Vec<Leg>,
    pub attestations: Vec<Attestation>,
    pub status: PlanStatus,
    pub total_notional_usd: u64,
    pub created_at_ns: u64,
    pub rejection_reason: Option<String>,
}

/// Request shape expected by the NEAR MPC signer (`v1.signer` / `v1.signer-prod.testnet`).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: PayloadV2,
    pub domain_id: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum PayloadV2 {
    Ecdsa(String),
    Eddsa(String),
}

#[ext_contract(ext_mpc)]
#[allow(dead_code)]
trait MpcSigner {
    fn sign(&mut self, request: SignRequest);
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub mpc_contract: AccountId,
    pub sign_deposit_yocto: String,
    pub next_plan_id: u64,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MamoruVault {
    owner: AccountId,
    mpc_contract: AccountId,
    sign_deposit: NearToken,
    policy: Policy,
    agents: IterableMap<AccountId, AgentInfo>,
    deposits: LookupMap<AccountId, NearToken>,
    plans: IterableMap<u64, Plan>,
    next_plan_id: u64,
}

#[near]
impl MamoruVault {
    #[init]
    pub fn new(owner: AccountId, mpc_contract: AccountId, policy: Policy) -> Self {
        Self::validate_policy(&policy);
        Self {
            owner,
            mpc_contract,
            sign_deposit: NearToken::from_yoctonear(1),
            policy: Self::normalize_policy(policy),
            agents: IterableMap::new(b"a"),
            deposits: LookupMap::new(b"d"),
            plans: IterableMap::new(b"p"),
            next_plan_id: 0,
        }
    }

    // ----- admin -------------------------------------------------------------

    pub fn register_agent(&mut self, agent: AccountId, role: AgentRole, tee_attestation_hash: String) {
        self.assert_owner();
        Self::assert_hex_hash(&tee_attestation_hash, "tee_attestation_hash");
        self.agents.insert(
            agent.clone(),
            AgentInfo { role, tee_attestation_hash, registered_at_ns: env::block_timestamp() },
        );
        env::log_str(&format!("EVENT agent_registered {} {:?}", agent, role));
    }

    pub fn remove_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        require!(self.agents.remove(&agent).is_some(), "Unknown agent");
        env::log_str(&format!("EVENT agent_removed {}", agent));
    }

    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        Self::validate_policy(&policy);
        self.policy = Self::normalize_policy(policy);
    }

    pub fn set_sign_deposit(&mut self, yocto: String) {
        self.assert_owner();
        let v: u128 = yocto.parse().unwrap_or_else(|_| env::panic_str("Invalid yocto amount"));
        self.sign_deposit = NearToken::from_yoctonear(v);
    }

    /// Circuit breaker: the owner or any Sentinel agent can halt execution instantly.
    pub fn pause(&mut self, reason: String) {
        let caller = env::predecessor_account_id();
        let is_sentinel = self
            .agents
            .get(&caller)
            .map(|a| a.role == AgentRole::Sentinel)
            .unwrap_or(false);
        require!(caller == self.owner || is_sentinel, "Only owner or Sentinel can pause");
        self.policy.paused = true;
        env::log_str(&format!("EVENT paused by={} reason={}", caller, reason));
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.policy.paused = false;
        env::log_str("EVENT unpaused");
    }

    // ----- users -------------------------------------------------------------

    /// Deposit NEAR to opt into the swarm. The balance is used to pay MPC signing fees.
    #[payable]
    pub fn deposit(&mut self) {
        let amount = env::attached_deposit();
        require!(amount > NearToken::from_yoctonear(0), "Attach a deposit");
        let who = env::predecessor_account_id();
        let cur = self.deposits.get(&who).copied().unwrap_or(NearToken::from_yoctonear(0));
        self.deposits.insert(who.clone(), cur.saturating_add(amount));
        env::log_str(&format!("EVENT deposit {} {}", who, amount.as_yoctonear()));
    }

    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        let who = env::predecessor_account_id();
        let cur = self.deposits.get(&who).copied().unwrap_or(NearToken::from_yoctonear(0));
        require!(amount > NearToken::from_yoctonear(0) && amount <= cur, "Insufficient balance");
        self.deposits.insert(who.clone(), cur.saturating_sub(amount));
        Promise::new(who).transfer(amount)
    }

    pub fn cancel_plan(&mut self, plan_id: u64) {
        let mut plan = self.get_plan_or_panic(plan_id);
        let caller = env::predecessor_account_id();
        require!(caller == plan.owner || caller == self.owner, "Not plan owner");
        require!(
            matches!(plan.status, PlanStatus::Pending | PlanStatus::Approved),
            "Plan cannot be cancelled"
        );
        require!(
            plan.legs.iter().all(|l| l.status == LegStatus::Pending),
            "Plan already has legs in flight"
        );
        plan.status = PlanStatus::Cancelled;
        self.plans.insert(plan_id, plan);
        env::log_str(&format!("EVENT plan_cancelled {}", plan_id));
    }

    // ----- swarm -------------------------------------------------------------

    /// Strategist submits a committed plan for `owner`. The submission counts as an approval.
    pub fn submit_plan(
        &mut self,
        owner: AccountId,
        plan_hash: String,
        legs: Vec<LegInput>,
        report_hash: String,
    ) -> u64 {
        let agent = self.assert_agent_role(&[AgentRole::Strategist]);
        require!(!self.policy.paused, "Vault is paused");
        Self::assert_hex_hash(&plan_hash, "plan_hash");
        Self::assert_hex_hash(&report_hash, "report_hash");
        require!(!legs.is_empty() && legs.len() <= MAX_LEGS, "1..=16 legs required");
        require!(
            self.deposits.get(&owner).map(|d| d.as_yoctonear() > 0).unwrap_or(false),
            "Owner has not opted in (no deposit)"
        );

        let mut total: u64 = 0;
        let mut out_legs = Vec::with_capacity(legs.len());
        for l in legs {
            let chain = l.chain.to_lowercase();
            require!(self.policy.allowed_chains.contains(&chain), format!("Chain not allowed: {}", chain));
            Self::validate_payload(&chain, l.kind, &l.payload_hex);
            total = total.checked_add(l.notional_usd).unwrap_or_else(|| env::panic_str("Overflow"));
            out_legs.push(Leg {
                chain,
                kind: l.kind,
                payload_hex: l.payload_hex.to_lowercase(),
                notional_usd: l.notional_usd,
                status: LegStatus::Pending,
                signature: None,
                settlement_ref: None,
            });
        }
        require!(total <= self.policy.max_plan_notional_usd, "Plan exceeds notional cap");

        let id = self.next_plan_id;
        self.next_plan_id += 1;
        let mut plan = Plan {
            id,
            owner: owner.clone(),
            plan_hash,
            legs: out_legs,
            attestations: vec![Attestation {
                agent,
                role: AgentRole::Strategist,
                risk_score: 0,
                verdict: Verdict::Approve,
                report_hash,
            }],
            status: PlanStatus::Pending,
            total_notional_usd: total,
            created_at_ns: env::block_timestamp(),
            rejection_reason: None,
        };
        self.evaluate(&mut plan);
        self.plans.insert(id, plan);
        env::log_str(&format!("EVENT plan_submitted id={} owner={} notional={}", id, owner, total));
        id
    }

    /// Sentinel / Matcher attest a plan. Any reject or over-limit risk score trips the firewall.
    pub fn attest(&mut self, plan_id: u64, risk_score: u8, verdict: Verdict, report_hash: String) -> PlanStatus {
        let agent = self.assert_agent_role(&[AgentRole::Sentinel, AgentRole::Matcher]);
        require!(risk_score <= 100, "risk_score must be 0-100");
        Self::assert_hex_hash(&report_hash, "report_hash");
        let mut plan = self.get_plan_or_panic(plan_id);
        require!(plan.status == PlanStatus::Pending, "Plan is not pending");
        require!(
            plan.attestations.iter().all(|a| a.agent != agent),
            "Agent already attested"
        );
        let role = self.agents.get(&agent).unwrap().role;
        plan.attestations.push(Attestation { agent, role, risk_score, verdict, report_hash });
        self.evaluate(&mut plan);
        let status = plan.status;
        self.plans.insert(plan_id, plan);
        env::log_str(&format!("EVENT plan_attested id={} status={:?}", plan_id, status));
        status
    }

    /// Sign a `Native` leg via Chain Signatures. Callable by the plan owner or any agent.
    pub fn execute_leg(&mut self, plan_id: u64, leg_index: u32) -> Promise {
        require!(!self.policy.paused, "Vault is paused");
        let caller = env::predecessor_account_id();
        let mut plan = self.get_plan_or_panic(plan_id);
        require!(
            caller == plan.owner || self.agents.contains_key(&caller),
            "Not authorized"
        );
        require!(plan.status == PlanStatus::Approved, "Plan not approved");
        let idx = leg_index as usize;
        require!(idx < plan.legs.len(), "Bad leg index");
        let leg = plan.legs[idx].clone();
        require!(leg.kind == LegKind::Native, "Intent legs settle via record_settlement");
        require!(
            matches!(leg.status, LegStatus::Pending | LegStatus::Failed),
            "Leg already signing/signed"
        );

        // Fee comes from the plan owner's deposit.
        let bal = self.deposits.get(&plan.owner).copied().unwrap_or(NearToken::from_yoctonear(0));
        require!(bal >= self.sign_deposit, "Owner deposit too low for signing fee");
        self.deposits.insert(plan.owner.clone(), bal.saturating_sub(self.sign_deposit));

        plan.legs[idx].status = LegStatus::Signing;
        let path = Self::path_for(&plan.owner, &leg.chain);
        let (payload_v2, domain_id) = Self::payload_for(&leg.chain, &leg.payload_hex);
        self.plans.insert(plan_id, plan);

        env::log_str(&format!("EVENT leg_signing plan={} leg={} path={}", plan_id, leg_index, path));
        ext_mpc::ext(self.mpc_contract.clone())
            .with_attached_deposit(self.sign_deposit)
            .with_unused_gas_weight(1)
            .sign(SignRequest { path, payload_v2, domain_id })
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_signed(plan_id, leg_index),
            )
    }

    #[private]
    pub fn on_signed(
        &mut self,
        plan_id: u64,
        leg_index: u32,
        #[callback_result] result: Result<Value, PromiseError>,
    ) -> Option<Value> {
        let mut plan = self.get_plan_or_panic(plan_id);
        let idx = leg_index as usize;
        let out = match result {
            Ok(sig) => {
                plan.legs[idx].status = LegStatus::Signed;
                plan.legs[idx].signature = Some(sig.to_string());
                env::log_str(&format!("EVENT leg_signed plan={} leg={}", plan_id, leg_index));
                Some(sig)
            }
            Err(_) => {
                plan.legs[idx].status = LegStatus::Failed;
                env::log_str(&format!("EVENT leg_failed plan={} leg={}", plan_id, leg_index));
                None
            }
        };
        self.plans.insert(plan_id, plan);
        out
    }

    /// Agents record the destination tx hash (Native) or NEAR Intents settlement (Intent).
    pub fn record_settlement(&mut self, plan_id: u64, leg_index: u32, settlement_ref: String) {
        self.assert_agent_role(&[AgentRole::Strategist, AgentRole::Matcher, AgentRole::Sentinel]);
        require!(!settlement_ref.is_empty() && settlement_ref.len() <= 256, "Bad settlement_ref");
        let mut plan = self.get_plan_or_panic(plan_id);
        require!(plan.status == PlanStatus::Approved, "Plan not approved");
        let idx = leg_index as usize;
        require!(idx < plan.legs.len(), "Bad leg index");
        let ok = match plan.legs[idx].kind {
            LegKind::Intent => plan.legs[idx].status == LegStatus::Pending,
            LegKind::Native => plan.legs[idx].status == LegStatus::Signed,
        };
        require!(ok, "Leg not in a settleable state");
        plan.legs[idx].status = LegStatus::Settled;
        plan.legs[idx].settlement_ref = Some(settlement_ref);
        if plan.legs.iter().all(|l| l.status == LegStatus::Settled) {
            plan.status = PlanStatus::Completed;
            env::log_str(&format!("EVENT plan_completed {}", plan_id));
        }
        self.plans.insert(plan_id, plan);
    }

    // ----- views -------------------------------------------------------------

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            mpc_contract: self.mpc_contract.clone(),
            sign_deposit_yocto: self.sign_deposit.as_yoctonear().to_string(),
            next_plan_id: self.next_plan_id,
        }
    }

    pub fn get_plan(&self, plan_id: u64) -> Option<Plan> {
        self.plans.get(&plan_id).cloned()
    }

    pub fn get_plans(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Plan> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(20).min(100);
        (from..self.next_plan_id.min(from.saturating_add(limit)))
            .filter_map(|i| self.plans.get(&i).cloned())
            .collect()
    }

    pub fn get_agents(&self) -> Vec<(AccountId, AgentInfo)> {
        self.agents.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_deposit(&self, account_id: AccountId) -> NearToken {
        self.deposits.get(&account_id).copied().unwrap_or(NearToken::from_yoctonear(0))
    }

    /// Derivation path used for `owner` on `chain`. Combine with the vault account id and the
    /// MPC root key to derive the foreign address off-chain.
    pub fn derivation_path(&self, owner: AccountId, chain: String) -> String {
        Self::path_for(&owner, &chain.to_lowercase())
    }

    // ----- internals ---------------------------------------------------------

    fn evaluate(&self, plan: &mut Plan) {
        if let Some(a) = plan.attestations.iter().find(|a| a.verdict == Verdict::Reject) {
            plan.status = PlanStatus::Rejected;
            plan.rejection_reason = Some(format!("{:?} {} rejected", a.role, a.agent));
            return;
        }
        if let Some(a) = plan.attestations.iter().find(|a| a.risk_score > self.policy.max_risk_score) {
            plan.status = PlanStatus::Rejected;
            plan.rejection_reason = Some(format!(
                "Risk {} > limit {} ({:?} {})",
                a.risk_score, self.policy.max_risk_score, a.role, a.agent
            ));
            return;
        }
        let approvals = plan.attestations.iter().filter(|a| a.verdict == Verdict::Approve).count();
        let sentinel_ok = !self.policy.require_sentinel
            || plan
                .attestations
                .iter()
                .any(|a| a.role == AgentRole::Sentinel && a.verdict == Verdict::Approve);
        if approvals >= self.policy.min_approvals as usize && sentinel_ok {
            plan.status = PlanStatus::Approved;
        }
    }

    fn path_for(owner: &AccountId, chain: &str) -> String {
        format!("mamorux/{}/{}", owner, chain)
    }

    fn payload_for(chain: &str, payload_hex: &str) -> (PayloadV2, u64) {
        if chain == "solana" {
            (PayloadV2::Eddsa(payload_hex.to_string()), 1)
        } else {
            (PayloadV2::Ecdsa(payload_hex.to_string()), 0)
        }
    }

    fn validate_payload(chain: &str, kind: LegKind, payload_hex: &str) {
        let bytes = hex::decode(payload_hex).unwrap_or_else(|_| env::panic_str("payload_hex not hex"));
        match (kind, chain) {
            (LegKind::Native, "solana") => {
                require!(bytes.len() >= 32 && bytes.len() <= 1232, "Solana payload must be 32..=1232 bytes")
            }
            _ => require!(bytes.len() == 32, "Payload must be 32 bytes"),
        }
    }

    fn assert_hex_hash(v: &str, name: &str) {
        require!(
            v.len() == 64 && v.chars().all(|c| c.is_ascii_hexdigit()),
            format!("{} must be a 32-byte hex string", name)
        );
    }

    fn validate_policy(p: &Policy) {
        require!(p.max_risk_score <= 100, "max_risk_score must be 0-100");
        require!(p.min_approvals >= 1, "min_approvals must be >= 1");
        require!(!p.allowed_chains.is_empty(), "allowed_chains empty");
    }

    fn normalize_policy(mut p: Policy) -> Policy {
        p.allowed_chains = p.allowed_chains.iter().map(|c| c.to_lowercase()).collect();
        p
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only owner");
    }

    fn assert_agent_role(&self, roles: &[AgentRole]) -> AccountId {
        let caller = env::predecessor_account_id();
        let info = self.agents.get(&caller).unwrap_or_else(|| env::panic_str("Not a registered agent"));
        require!(roles.contains(&info.role), "Agent role not permitted");
        caller
    }

    fn get_plan_or_panic(&self, id: u64) -> Plan {
        self.plans.get(&id).cloned().unwrap_or_else(|| env::panic_str("Unknown plan"))
    }
}

#[cfg(test)]
mod tests;
