import Image from "next/image";

/** Decorative client marks; the surrounding setup action keeps its accessible name. */
export function AgentLogoCluster() {
  return (
    <span className="agent-logo-cluster" aria-hidden="true" title="Codex, Claude and Cursor">
      {["codex", "claude-color", "cursor"].map((logo) => (
        <span key={logo}>
          <Image src={`/agent-logos/${logo}.svg`} alt="" width={18} height={18} />
        </span>
      ))}
    </span>
  );
}
