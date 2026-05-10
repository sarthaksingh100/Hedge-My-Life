import React from "react";

const iconProps = {
  width: "18",
  height: "18",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
};

export function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

export function UmbrellaIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 12a10 10 0 0 0-20 0Z" />
      <path d="M12 12v7a3 3 0 0 0 6 0" />
      <path d="M12 2v2" />
    </svg>
  );
}

export function CarIcon() {
  return (
    <svg {...iconProps}>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 10 16 6H8l-2.4 4-2.1 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

export function PlaneIcon() {
  return (
    <svg {...iconProps}>
      <path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2 3.5 7.5l6.3 3.7-3.6 3.6-2.4-.4-1 1 3.8 2.1 2.1 3.8 1-1-.4-2.4 3.6-3.6 3.7 6.3Z" />
    </svg>
  );
}

export function ReceiptIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

export function CartIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.1 2.1h2l2.7 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L21 7H5.1" />
    </svg>
  );
}

export function BookIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

export function SlidersIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M2 14h4" />
      <path d="M10 8h4" />
      <path d="M18 16h4" />
    </svg>
  );
}
