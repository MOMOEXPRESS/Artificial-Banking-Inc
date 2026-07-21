import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/**
 * Expo companion — approve-on-the-go.
 * Guardian key lives in SecureStore (falls back to EXPO_PUBLIC_GUARDIAN_KEY for first run).
 * Push notifications: wire expo-notifications + server webhook in a follow-up.
 */
const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
const KEY_STORAGE = "abi_guardian_key_v1";

type Approval = {
  id: string;
  agentId: string;
  amountUsdc: string;
  destination: string;
  reasons: string[];
  expiresAt: string;
  status: string;
};

async function loadKey(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(KEY_STORAGE);
    if (stored) return stored;
  } catch {
    /* web / unsupported */
  }
  return process.env.EXPO_PUBLIC_GUARDIAN_KEY ?? "";
}

async function saveKey(key: string) {
  try {
    await SecureStore.setItemAsync(KEY_STORAGE, key);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [key, setKey] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const k = await loadKey();
      setKey(k);
      setDraft(k);
      setLoading(false);
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!key) {
      setError("Save a guardian key to connect.");
      return;
    }
    try {
      const res = await fetch(`${API}/v1/guardian/approvals`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
      });
      const data = (await res.json()) as Approval[];
      setPending(data.filter((a) => a.status === "pending"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    void refresh();
    const t = setInterval(() => void refresh(), 10000);
    return () => clearInterval(t);
  }, [key, refresh]);

  async function resolve(id: string, approve: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`${API}/v1/guardian/approvals/${id}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ approve, resolvedBy: "guardian-expo" }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!key) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.title}>ABI Approvals</Text>
          <Text style={styles.sub}>Paste your guardian key — stored in SecureStore on device.</Text>
        </View>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="pv_guardian_…"
          placeholderTextColor="#5e5e68"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[styles.btn, styles.approve, { marginHorizontal: 20, marginTop: 12 }]}
          onPress={() => {
            void saveKey(draft.trim()).then(() => setKey(draft.trim()));
          }}
        >
          <Text style={styles.btnText}>Save & connect</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Approvals</Text>
        <Text style={styles.sub}>{pending.length} waiting · SecureStore key</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {pending.length === 0 ? (
        <Text style={styles.empty}>Inbox zero — nothing needs you.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {pending.map((a) => (
            <View key={a.id} style={styles.card}>
              <Text style={styles.amt}>${a.amountUsdc}</Text>
              <Text style={styles.meta}>{a.destination}</Text>
              <Text style={styles.reason}>{a.reasons.join(" · ")}</Text>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.approve]}
                  disabled={busy === a.id}
                  onPress={() => void resolve(a.id, true)}
                >
                  <Text style={styles.btnText}>Approve</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.deny]}
                  disabled={busy === a.id}
                  onPress={() => void resolve(a.id, false)}
                >
                  <Text style={styles.btnText}>Deny</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0c" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { color: "#f4f4f6", fontSize: 24, fontWeight: "700" },
  sub: { color: "#8e8e99", fontSize: 13, marginTop: 4 },
  input: {
    marginHorizontal: 20,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 12,
    color: "#f4f4f6",
    fontFamily: "monospace",
  },
  list: { padding: 16, gap: 12 },
  card: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 16,
    marginBottom: 12,
    backgroundColor: "#141416",
  },
  amt: { color: "#f4f4f6", fontSize: 22, fontFamily: "monospace", fontWeight: "700" },
  meta: { color: "#c8c8d0", fontSize: 13, marginTop: 6, fontFamily: "monospace" },
  reason: { color: "#8e8e99", fontSize: 12, marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  approve: { backgroundColor: "#3b82f6" },
  deny: { backgroundColor: "#ef4444" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  empty: { color: "#8e8e99", textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  error: { color: "#ef4444", padding: 20, fontSize: 13 },
});
