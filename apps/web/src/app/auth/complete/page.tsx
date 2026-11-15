import { cookies } from "next/headers";
import { CompleteSignIn } from "@/lib/complete-sign-in";
export const dynamic = "force-dynamic";
export default async function Page() {
  const jar = await cookies();
  return (
    <CompleteSignIn
      destination={jar.get("abi_auth_destination")?.value === "seller" ? "seller" : "console"}
    />
  );
}
