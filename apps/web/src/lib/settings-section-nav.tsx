"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
type Item = { key: string; label: string; icon: string; group: string };
export function SettingsSectionNav({
  items,
  value,
  onChange,
}: {
  items: readonly Item[];
  value: string;
  onChange: (key: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => {
      const button = el.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (!button) return;
      setMarker({
        left: button.offsetLeft,
        top: button.offsetTop,
        width: button.offsetWidth,
        height: button.offsetHeight,
      });
    };
    update();
    const selected = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected)
      el.scrollTo({
        left: Math.max(0, selected.offsetLeft - (el.clientWidth - selected.offsetWidth) / 2),
        top: Math.max(0, selected.offsetTop - (el.clientHeight - selected.offsetHeight) / 2),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <div ref={root} className="abi-settings-tabs" role="tablist" aria-label="Settings navigation">
      <span
        aria-hidden="true"
        className="abi-settings-marker"
        style={{
          width: marker.width,
          height: marker.height,
          transform: `translate(${marker.left}px,${marker.top}px)`,
        }}
      />
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          id={`settings-tab-${item.key}`}
          role="tab"
          aria-selected={value === item.key}
          aria-controls="settings-panel"
          tabIndex={value === item.key ? 0 : -1}
          onClick={() => onChange(item.key)}
          onKeyDown={(e) => {
            const index =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? (i + 1) % items.length
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? (i + items.length - 1) % items.length
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : -1;
            if (index >= 0) {
              e.preventDefault();
              onChange(items[index].key);
              document.getElementById(`settings-tab-${items[index].key}`)?.focus();
            }
          }}
        >
          <Icon name={item.icon} size={18} />
          <span>
            {item.label}
            <small>{item.group}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
