"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const links = [
  { href: "/dashboard", label: "Product" },
  { href: "/demo-store", label: "Solutions" },
  { href: "/test", label: "Developers" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#docs", label: "Docs" },
];

function InvoqMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 4.5h9.5V14H5z" fill="currentColor" />
      <path d="M17.5 4.5H27V14h-9.5z" fill="currentColor" opacity=".42" />
      <path d="M5 17h9.5v9.5H5z" fill="currentColor" opacity=".42" />
      <path d="m22.25 16.3 5.45 5.45-5.45 5.45-5.45-5.45z" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

export default function Navbar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="invoq-nav">
      <nav className="invoq-nav-inner" aria-label="Main navigation">
        <Link href="/" className="invoq-wordmark" aria-label="Invoq home">
          <InvoqMark className="invoq-mark" />
          <span>invoq</span>
        </Link>

        <div className="invoq-nav-links">
          {links.map((link) => (
            <Link key={link.label} href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>

        <div className="invoq-nav-actions">
          <Link href="/signup" className="invoq-pill invoq-pill-primary">
            Start building
          </Link>
          <Link href="/login" className="invoq-pill invoq-pill-light">
            Log in
          </Link>
        </div>

        <button
          type="button"
          className="invoq-menu-button"
          aria-label="Open navigation menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span />
          <span />
        </button>
      </nav>

      <div className={`invoq-menu ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <button
          className="invoq-menu-backdrop"
          onClick={() => setOpen(false)}
          aria-label="Close navigation menu"
          tabIndex={open ? 0 : -1}
        />
        <aside className="invoq-menu-sheet" aria-label="Mobile navigation">
          <div className="invoq-menu-header">
            <Link href="/" className="invoq-wordmark" onClick={() => setOpen(false)}>
              <InvoqMark className="invoq-mark" />
              <span>invoq</span>
            </Link>
            <button
              type="button"
              className="invoq-menu-close"
              onClick={() => setOpen(false)}
              aria-label="Close navigation menu"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="invoq-menu-rule" />
          <div className="invoq-menu-links">
            {links.map((link, index) => (
              <Link
                key={link.label}
                href={link.href}
                style={{ "--menu-index": index } as React.CSSProperties}
                onClick={() => setOpen(false)}
              >
                {link.label}
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
          <div className="invoq-menu-actions">
            <Link href="/signup" className="invoq-pill invoq-pill-primary" onClick={() => setOpen(false)}>
              Start building
            </Link>
            <Link href="/login" className="invoq-pill invoq-pill-light" onClick={() => setOpen(false)}>
              Log in
            </Link>
          </div>
        </aside>
      </div>
    </header>
  );
}
