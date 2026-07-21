import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * Expo v0 — guardian approvals companion.
 * Reads pending approvals from the ABI API using a guardian key stored in
 * SecureStore in production; v0 accepts EXPO_PUBLIC_GUARDIAN_KEY for dev.
 *
 * For production, prefer the installable PWA at /approvals on the web app.
 */
const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
const KEY = process.env.EXPO_PUBLIC_GUARDIAN_KEY ?? "";

type Approval = {
  id: string;
  agentId: string;
  amountUsdc: string;
  destination: string;
  reasons: string[];
  expiresAt: string;
  status: string;
};

export default function App() {
  const [pending, setPending] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${KEY}`,
  };

  const refresh = useCallback(async () => {
    if (!KEY) {
      setError("Set EXPO_PUBLIC_GUARDIAN_KEY to connect.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API}/v1/guardian/approvals`, { headers });
      const data = (await res.json()) as Approval[];
      setPending(data.filter((a) => a.status === "pending"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10000);
    return () => clearInterval(t);
  }, [refresh]);

  async function resolve(id: string, approve: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`${API}/v1/guardian/approvals/${id}/resolve`, {
        method: "POST",
        headers,
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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Approvals</Text>
        <Text style={styles.sub}>{pending.length} waiting</Text>
      </View>
      {loading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : pending.length === 0 ? (
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
