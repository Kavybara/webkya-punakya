import type { CSSProperties } from "react";
import { NavLink } from "react-router-dom";
import type { AppShellNavGroup, AppShellNavItem } from "./AppShell";

/*
 * The rail's navigation.
 *
 * This was a fragment inside AppShell -- a map over groups, a map over items,
 * and a conditional label or divider -- inlined into a `nav` variable that was
 * then rendered twice, once into the fixed rail and once into the phone
 * drawer. It worked, and it was the reason the rail was the least interesting
 * object in the product: a link there was a `<NavLink>` with a class name on
 * it, and its "selected" state was a border colour and a box-shadow. There was
 * nothing in the markup that corresponded to "you are here".
 *
 * So the link is now a composite. It owns a rail -- a real element, lit from
 * the accent, that grows down the left edge of whichever link is current --
 * and it enters on a stagger. Both of those are why it is a component and not
 * a JSX map: the rail is a structural thing, and a structural thing has to
 * survive being rendered in two places at once.
 *
 * The stagger is applied with an inline `animation-delay` rather than a custom
 * property in the stylesheet, because the token guard reads any `--*`
 * declaration in a stylesheet as a design token, and an index is not one.
 */

/** Milliseconds between one link entering and the next. */
const STAGGER_MS = 28;

function ShellNavItemLink({
  item,
  collapsed,
  delay,
  onNavigate,
}: {
  item: AppShellNavItem;
  collapsed: boolean;
  delay: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.end}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) => `ui-shell-nav-item${isActive ? " is-active" : ""}`}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
    >
      {/* The lit edge. Present on every link so it can be there the instant
          the route changes -- an element that mounts on demand would have to
          animate in from nothing every time the reader navigates, which reads
          as a flicker rather than as motion. */}
      <i className="ui-shell-nav-rail" aria-hidden="true" />
      <Icon size={18} aria-hidden="true" />
      {!collapsed ? <span>{item.label}</span> : null}
      {item.badge ? (
        <b className="ui-shell-nav-badge" aria-label={`${item.badge} baru`}>
          {item.badge}
        </b>
      ) : null}
    </NavLink>
  );
}

export function ShellNav({
  groups,
  collapsed,
  label,
  onNavigate,
}: {
  groups: AppShellNavGroup[];
  collapsed: boolean;
  label: string;
  onNavigate?: () => void;
}) {
  // A running index across every group, so the stagger reads as one movement
  // down the rail rather than as several independent ones.
  let index = 0;
  return (
    <nav className="ui-shell-nav" aria-label={label}>
      {groups.map((group) => (
        <div key={group.label} className="ui-shell-nav-group">
          {collapsed ? (
            <span className="ui-shell-nav-divider" />
          ) : (
            <p className="ui-shell-nav-caption">{group.label}</p>
          )}
          {group.items.map((item) => (
            <ShellNavItemLink
              key={item.path}
              item={item}
              collapsed={collapsed}
              delay={index++ * STAGGER_MS}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
