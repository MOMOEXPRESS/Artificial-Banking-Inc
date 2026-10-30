import Link from "next/link";
import { AGENT_LOGOS, type AgentLogo } from "./agent-logos";
import { Icon } from "./ui";
import styles from "./agent-logo-marquee.module.css";

/**
 * "Connect your agent" band on the public home page: a slow, CSS-only logo
 * marquee of model providers whose agents can connect to ABI. Pauses on hover
 * or keyboard focus; with prefers-reduced-motion it becomes a static wrap.
 */
export function AgentLogoMarquee() {
  return (
    <section className={styles.band} aria-labelledby="agent-logos-title" data-testid="agent-logos">
      <div className={styles.inner}>
        <div className={styles.copy}>
          <span className={`eyebrow ${styles.eyebrow}`}>Connect your agent</span>
          <h2 id="agent-logos-title">Bring the agent you already use.</h2>
          <p>
            ABI is provider-independent. Agents built on any of these models can connect through the
            agent API or MCP with a scoped, revocable key.
          </p>
        </div>
        <div className={styles.viewport}>
          <div className={styles.track}>
            <LogoGroup label="Model providers whose agents can connect" />
            <LogoGroup duplicate />
          </div>
        </div>
        <div className={styles.foot}>
          <p className={styles.note}>
            Logos are trademarks of their owners and do not imply endorsement.
          </p>
          <Link className="btn-ghost" href="/docs#chatgpt">
            How agents connect <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function LogoGroup({ label, duplicate = false }: { label?: string; duplicate?: boolean }) {
  return (
    <ul
      className={`${styles.group} ${duplicate ? styles.duplicate : ""}`}
      aria-label={duplicate ? undefined : label}
      aria-hidden={duplicate ? true : undefined}
    >
      {AGENT_LOGOS.map((logo) => (
        <LogoItem key={logo.slug} logo={logo} />
      ))}
    </ul>
  );
}

function LogoItem({ logo }: { logo: AgentLogo }) {
  return (
    <li className={styles.item}>
      <svg className={styles.logo} viewBox="0 0 24 24" role="img" aria-label={`${logo.name} logo`}>
        <path d={logo.path} />
      </svg>
      <span>{logo.name}</span>
    </li>
  );
}
