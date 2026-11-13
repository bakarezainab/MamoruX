use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const H: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn owner() -> AccountId { accounts(0) }
fn user() -> AccountId { accounts(1) }
fn strategist() -> AccountId { accounts(2) }
fn sentinel() -> AccountId { accounts(3) }
fn matcher() -> AccountId { accounts(4) }
fn vault() -> AccountId { "vault.testnet".parse().unwrap() }

fn ctx(pred: AccountId, deposit: u128) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(vault())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
}

fn policy() -> Policy {
    Policy {
        max_risk_score: 60,
        min_approvals: 2,
        require_sentinel: true,
        allowed_chains: vec!["Ethereum".into(), "bitcoin".into(), "solana".into(), "near".into()],
        max_plan_notional_usd: 1_000_000,
        paused: false,
    }
}

fn setup() -> MamoruVault {
    ctx(owner(), 0);
    let mut c = MamoruVault::new(owner(), "v1.signer-prod.testnet".parse().unwrap(), policy());
    c.register_agent(strategist(), AgentRole::Strategist, H.into());
    c.register_agent(sentinel(), AgentRole::Sentinel, H.into());
    c.register_agent(matcher(), AgentRole::Matcher, H.into());
    ctx(user(), 10u128.pow(24));
    c.deposit();
    c
}

fn native_leg(chain: &str, n: u64) -> LegInput {
    LegInput { chain: chain.into(), kind: LegKind::Native, payload_hex: H2.into(), notional_usd: n }
}
fn intent_leg(n: u64) -> LegInput {
    LegInput { chain: "near".into(), kind: LegKind::Intent, payload_hex: H.into(), notional_usd: n }
}

fn submit(c: &mut MamoruVault, legs: Vec<LegInput>) -> u64 {
    ctx(strategist(), 0);
    c.submit_plan(user(), H.into(), legs, H.into())
}

#[test]
fn policy_chains_are_normalized() {
    let c = setup();
    assert!(c.get_policy().allowed_chains.contains(&"ethereum".to_string()));
}

#[test]
fn deposit_and_withdraw() {
    let mut c = setup();
    assert_eq!(c.get_deposit(user()).as_yoctonear(), 10u128.pow(24));
    ctx(user(), 0);
    let _ = c.withdraw(NearToken::from_yoctonear(4 * 10u128.pow(23)));
    assert_eq!(c.get_deposit(user()).as_yoctonear(), 6 * 10u128.pow(23));
}

#[test]
#[should_panic(expected = "Insufficient balance")]
fn withdraw_too_much() {
    let mut c = setup();
    ctx(user(), 0);
    let _ = c.withdraw(NearToken::from_near(2));
}

#[test]
fn full_happy_path_sentinel_quorum() {
    let mut c = setup();
    let id = submit(&mut c, vec![native_leg("ethereum", 500), intent_leg(300)]);
    assert_eq!(c.get_plan(id).unwrap().status, PlanStatus::Pending);
    assert_eq!(c.get_plan(id).unwrap().total_notional_usd, 800);

    ctx(sentinel(), 0);
    assert_eq!(c.attest(id, 20, Verdict::Approve, H.into()), PlanStatus::Approved);

    // Native leg -> Chain Signatures
    ctx(user(), 0);
    let _ = c.execute_leg(id, 0);
    assert_eq!(c.get_plan(id).unwrap().legs[0].status, LegStatus::Signing);
    assert_eq!(c.get_deposit(user()).as_yoctonear(), 10u128.pow(24) - 1);

    ctx(vault(), 0);
    let sig = near_sdk::serde_json::json!({"scheme":"Secp256k1","big_r":{"affine_point":"02ab"},"s":{"scalar":"cd"},"recovery_id":0});
    assert!(c.on_signed(id, 0, Ok(sig)).is_some());
    assert_eq!(c.get_plan(id).unwrap().legs[0].status, LegStatus::Signed);

    ctx(matcher(), 0);
    c.record_settlement(id, 0, "0xethtxhash".into());
    c.record_settlement(id, 1, "intents:abc".into());
    let p = c.get_plan(id).unwrap();
    assert_eq!(p.status, PlanStatus::Completed);
    assert_eq!(p.legs[1].settlement_ref.as_deref(), Some("intents:abc"));
}

#[test]
fn matcher_alone_is_not_enough_when_sentinel_required() {
    let mut c = setup();
    let id = submit(&mut c, vec![intent_leg(10)]);
    ctx(matcher(), 0);
    assert_eq!(c.attest(id, 5, Verdict::Approve, H.into()), PlanStatus::Pending);
    ctx(sentinel(), 0);
    assert_eq!(c.attest(id, 5, Verdict::Approve, H.into()), PlanStatus::Approved);
}

#[test]
fn firewall_rejects_high_risk() {
    let mut c = setup();
    let id = submit(&mut c, vec![intent_leg(10)]);
    ctx(sentinel(), 0);
    assert_eq!(c.attest(id, 95, Verdict::Approve, H.into()), PlanStatus::Rejected);
    assert!(c.get_plan(id).unwrap().rejection_reason.unwrap().contains("Risk 95"));
}

#[test]
fn firewall_rejects_on_veto() {
    let mut c = setup();
    let id = submit(&mut c, vec![intent_leg(10)]);
    ctx(sentinel(), 0);
    assert_eq!(c.attest(id, 1, Verdict::Reject, H.into()), PlanStatus::Rejected);
}

#[test]
#[should_panic(expected = "Agent already attested")]
fn no_double_attest() {
    let mut c = setup();
    let id = submit(&mut c, vec![intent_leg(10)]);
    ctx(matcher(), 0);
    c.attest(id, 1, Verdict::Approve, H.into());
    c.attest(id, 1, Verdict::Approve, H.into());
}

#[test]
#[should_panic(expected = "Chain not allowed")]
fn rejects_disallowed_chain() {
    let mut c = setup();
    submit(&mut c, vec![native_leg("dogecoin", 1)]);
}

#[test]
#[should_panic(expected = "Plan exceeds notional cap")]
fn rejects_over_cap() {
    let mut c = setup();
    submit(&mut c, vec![intent_leg(600_000), intent_leg(600_000)]);
}

#[test]
#[should_panic(expected = "Agent role not permitted")]
fn sentinel_cannot_submit() {
    let mut c = setup();
    ctx(sentinel(), 0);
    c.submit_plan(user(), H.into(), vec![intent_leg(1)], H.into());
}

#[test]
#[should_panic(expected = "Not a registered agent")]
fn stranger_cannot_attest() {
    let mut c = setup();
    let id = submit(&mut c, vec![intent_leg(1)]);
    ctx(accounts(5), 0);
    c.attest(id, 1, Verdict::Approve, H.into());
}

#[test]
#[should_panic(expected = "Owner has not opted in")]
fn requires_owner_deposit() {
    let mut c = setup();
    ctx(strategist(), 0);
    c.submit_plan(accounts(5), H.into(), vec![intent_leg(1)], H.into());
}

#[test]
#[should_panic(expected = "Plan not approved")]
fn cannot_execute_unapproved() {
    let mut c = setup();
    let id = submit(&mut c, vec![native_leg("bitcoin", 1)]);
    ctx(user(), 0);
    let _ = c.execute_leg(id, 0);
}

#[test]
#[should_panic(expected = "Vault is paused")]
fn sentinel_circuit_breaker_blocks_execution() {
    let mut c = setup();
    let id = submit(&mut c, vec![native_leg("bitcoin", 1)]);
    ctx(sentinel(), 0);
    c.attest(id, 1, Verdict::Approve, H.into());
    c.pause("exploit detected on target pool".into());
    ctx(user(), 0);
    let _ = c.execute_leg(id, 0);
}

#[test]
#[should_panic(expected = "Only owner or Sentinel can pause")]
fn matcher_cannot_pause() {
    let mut c = setup();
    ctx(matcher(), 0);
    c.pause("x".into());
}

#[test]
fn failed_signature_can_retry() {
    let mut c = setup();
    let id = submit(&mut c, vec![native_leg("solana", 1)]);
    ctx(sentinel(), 0);
    c.attest(id, 1, Verdict::Approve, H.into());
    ctx(user(), 0);
    let _ = c.execute_leg(id, 0);
    ctx(vault(), 0);
    assert!(c.on_signed(id, 0, Err(PromiseError::Failed)).is_none());
    assert_eq!(c.get_plan(id).unwrap().legs[0].status, LegStatus::Failed);
    ctx(user(), 0);
    let _ = c.execute_leg(id, 0);
    assert_eq!(c.get_plan(id).unwrap().legs[0].status, LegStatus::Signing);
}

#[test]
#[should_panic(expected = "Intent legs settle via record_settlement")]
fn intent_legs_are_not_mpc_signed() {
    let mut c = setup();
    let id = submit(&mut c, vec![intent_leg(1)]);
    ctx(sentinel(), 0);
    c.attest(id, 1, Verdict::Approve, H.into());
    ctx(user(), 0);
    let _ = c.execute_leg(id, 0);
}

#[test]
#[should_panic(expected = "Payload must be 32 bytes")]
fn ecdsa_payload_must_be_32_bytes() {
    let mut c = setup();
    submit(&mut c, vec![LegInput { chain: "ethereum".into(), kind: LegKind::Native, payload_hex: "abcd".into(), notional_usd: 1 }]);
}

#[test]
fn cancel_pending_plan() {
    let mut c = setup();
    let id = submit(&mut c, vec![intent_leg(1)]);
    ctx(user(), 0);
    c.cancel_plan(id);
    assert_eq!(c.get_plan(id).unwrap().status, PlanStatus::Cancelled);
}

#[test]
fn derivation_path_is_per_user_per_chain() {
    let c = setup();
    assert_eq!(c.derivation_path(user(), "Ethereum".into()), format!("mamorux/{}/ethereum", user()));
}

#[test]
fn pagination() {
    let mut c = setup();
    for _ in 0..5 { submit(&mut c, vec![intent_leg(1)]); }
    assert_eq!(c.get_plans(Some(1), Some(3)).len(), 3);
    assert_eq!(c.get_plans(None, None).len(), 5);
}
