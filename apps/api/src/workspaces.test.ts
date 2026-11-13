import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
const directory = mkdtempSync(join(tmpdir(), "abi-workspaces-"));
process.env.POLICYVAULT_DB = join(directory, "test.db");
process.env.ABI_KEY_PEPPER = "test-pepper";
process.env.ABI_NO_LISTEN = "1";
process.env.ABI_CHAT_LLM = "0";
const { store, commerceDatabase } = await import("./store.js");
const {
  ensureWorkspaces,
  createWorkspace,
  findWorkspace,
  viewWorkspace,
  connectAgent,
  setCard,
  allocateWorkspace,
  reserveCard,
  finishCardReservation,
} = await import("./workspaces.js");
const { agentFundingContext, executeIntent } = await import("./engine.js");
const { workspaceRequest } = await import("./workspace-context.js");
after(() => rmSync(directory, { recursive: true, force: true }));
function setup() {
  const org = store.createOrg("Workspace test", 100_000_000n);
  const general = ensureWorkspaces(org.id)[0]!;
  const travel = createWorkspace(org.id, "Travel", crypto.randomUUID());
  return { org, general: viewWorkspace(org.id, String(general.id)), travel };
}

test("workspace creation is atomic, zero-funded and idempotent with exactly one card", () => {
  const { org, travel } = setup();
  const key = crypto.randomUUID();
  const a = createWorkspace(org.id, "Research", key),
    b = createWorkspace(org.id, "Research", key);
  assert.equal(a.id, b.id);
  assert.equal(a.balance.availableUsdc, "0");
  assert.equal(a.card.limitUsdc, "0");
  assert.equal(a.connections.length, 0);
  assert.equal(
    (
      commerceDatabase()
        .prepare("SELECT COUNT(*) n FROM abi_workspace_cards WHERE workspace_id=?")
        .get(a.id) as { n: number }
    ).n,
    1,
  );
  assert.throws(() => createWorkspace(org.id, "Different", key), /already used/);
  assert.equal(viewWorkspace(org.id, travel.id).balance.availableUsdc, "0");
  assert.equal(store.reconcileOrg(org.id).ok, true);
});
test("legacy backfill retains real balances and does not create workspaces for labels", () => {
  const org = store.createOrg("Legacy", 80_000_000n);
  const budget = store.createDepartment(org.id, "Existing");
  const a = store.createAgent(org.id, "Old agent", budget.id);
  store.createAgentGroup(org.id, "Label one", budget.id);
  store.createAgentGroup(org.id, "Label two", budget.id);
  const before = [...store.getAccountMap(org.id)].map(([id, a]) => [id, a.balanceMicro.toString()]);
  ensureWorkspaces(org.id);
  ensureWorkspaces(org.id);
  assert.equal(ensureWorkspaces(org.id).length, 2);
  for (const [id, balance] of before)
    assert.equal(store.getAccountMap(org.id).get(String(id))?.balanceMicro.toString(), balance);
  assert.equal(store.getAgentByKey(a.apiKey)?.id, a.agentId);
  assert.equal(agentFundingContext(a.agentId, org.id)?.availableId, `dept:${budget.id}:available`);
});
test("allocation moves available funds once, shares a receipt and never resets limits", () => {
  const { org, general, travel } = setup();
  setCard(org.id, travel.id, { limitUsdc: "12" });
  const key = crypto.randomUUID();
  const a = allocateWorkspace(org.id, general.id, travel.id, "25", key),
    b = allocateWorkspace(org.id, general.id, travel.id, "25", key);
  assert.equal(a.id, b.id);
  assert.equal(viewWorkspace(org.id, general.id).balance.availableUsdc, "75");
  assert.equal(viewWorkspace(org.id, travel.id).balance.availableUsdc, "25");
  assert.equal(viewWorkspace(org.id, travel.id).card.limitUsdc, "12");
  assert.equal(store.reconcileOrg(org.id).ok, true);
  assert.throws(
    () => allocateWorkspace(org.id, general.id, travel.id, "26", key),
    /different details/,
  );
  assert.throws(
    () => allocateWorkspace(org.id, general.id, general.id, "1", crypto.randomUUID()),
    /different workspaces/,
  );
  const other = setup();
  assert.throws(
    () => allocateWorkspace(org.id, general.id, other.travel.id, "1", crypto.randomUUID()),
    /Choose a workspace/,
  );
});
test("large allocations preserve treasury review and retries do not move funds", () => {
  const { org, general, travel } = setup(),
    key = crypto.randomUUID();
  const result = allocateWorkspace(org.id, general.id, travel.id, "75", key);
  assert.equal(result.status, "pending");
  assert.equal(result.journal_id, null);
  assert.equal(allocateWorkspace(org.id, general.id, travel.id, "75", key).status, "pending");
  assert.equal(viewWorkspace(org.id, general.id).balance.availableUsdc, "100");
  assert.equal(viewWorkspace(org.id, travel.id).balance.availableUsdc, "0");
});
test("separate agent keys share card capacity and cannot retarget funding", async () => {
  const { org, travel } = setup();
  setCard(org.id, travel.id, { limitUsdc: "100" });
  const a = connectAgent(org.id, travel.id, {
      name: "One",
      pay: true,
      ttlHours: 24,
      key: crypto.randomUUID(),
    }),
    b = connectAgent(org.id, travel.id, {
      name: "Two",
      pay: true,
      ttlHours: 24,
      key: crypto.randomUUID(),
    });
  assert.notEqual(a.sessionKey.token, b.sessionKey.token);
  assert.equal(store.getSessionByToken(a.sessionKey.token!)?.agent.id, a.agentId);
  assert.equal(
    agentFundingContext(a.agentId, org.id)?.availableId,
    agentFundingContext(b.agentId, org.id)?.availableId,
  );
  const attempts = await Promise.allSettled([
    Promise.resolve().then(() => reserveCard(a.agentId, "intent_a", 75_000_000n, "pay")),
    Promise.resolve().then(() => reserveCard(b.agentId, "intent_b", 75_000_000n, "pay")),
  ]);
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.equal(viewWorkspace(org.id, travel.id).card.pendingUsdc, "75");
  const other = createWorkspace(org.id, "Other", crypto.randomUUID());
  assert.equal(
    store.assignAgentBudget(org.id, a.agentId, String(findWorkspace(org.id, other.id).funding_id)),
    "invalid",
  );
  finishCardReservation("intent_a", "released");
  assert.equal(viewWorkspace(org.id, travel.id).card.pendingUsdc, "0");
});
test("freezing a card stops all its keys without invalidating read access or refund mappings", async () => {
  const { org, travel } = setup();
  const a = connectAgent(org.id, travel.id, {
    name: "One",
    pay: true,
    ttlHours: 24,
    key: crypto.randomUUID(),
  });
  setCard(org.id, travel.id, { status: "frozen" });
  assert.ok(store.getSessionByToken(a.sessionKey.token!));
  assert.throws(() => reserveCard(a.agentId, "freeze", 1n, "pay"), /frozen/);
  assert.ok(agentFundingContext(a.agentId, org.id));
  const result = await executeIntent({
    orgId: org.id,
    agentId: a.agentId,
    intentId: "freeze_api",
    tool: "pay",
    amountMicro: 1n,
    amountUsdc: "0.000001",
    destination: "vendor:test",
  });
  assert.equal(result.ok, false);
  assert.equal((result.payload.error as { code: string }).code, "CARD_FROZEN");
});
test("scoped conversation and durable notes never cross workspaces", () => {
  const { org, general, travel } = setup();
  store.appendChatMessage({ orgId: org.id, role: "user", kind: "text", body: "Legacy General" });
  workspaceRequest.run({ orgId: org.id, workspaceId: travel.id }, () => {
    store.appendChatMessage({ orgId: org.id, role: "user", kind: "text", body: "Travel private" });
    store.addAbiMemory(org.id, "travel only");
    assert.equal(store.listChatMessages(org.id).length, 1);
    assert.equal(store.listAbiMemories(org.id).length, 1);
  });
  workspaceRequest.run({ orgId: org.id, workspaceId: general.id }, () => {
    assert.deepEqual(
      store.listChatMessages(org.id).map((m) => m.body),
      ["Legacy General"],
    );
    assert.equal(store.listAbiMemories(org.id).length, 0);
    store.clearAbiMemories(org.id);
  });
  workspaceRequest.run({ orgId: org.id, workspaceId: travel.id }, () =>
    assert.equal(store.listAbiMemories(org.id).length, 1),
  );
});
