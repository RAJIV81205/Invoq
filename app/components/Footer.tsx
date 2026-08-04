import Link from "next/link";

function FooterMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
      <path d="M5 4.5h9.5V14H5z" fill="currentColor" />
      <path d="M17.5 4.5H27V14h-9.5z" fill="currentColor" opacity=".42" />
      <path d="M5 17h9.5v9.5H5z" fill="currentColor" opacity=".42" />
      <path d="m22.25 16.3 5.45 5.45-5.45 5.45-5.45-5.45z" fill="currentColor" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className="invoq-footer">
      <div className="invoq-footer-main">
        <div className="invoq-footer-brand">
          <Link href="/" aria-label="Invoq home">
            <FooterMark />
            <span>invoq</span>
          </Link>
          <p>
            Programmable subscription billing infrastructure for Stellar. Built on x402,
            Soroban, and Stellar USDC.
          </p>
        </div>
        <div className="invoq-footer-column">
          <h3>Product</h3>
          <ul>
            <li><Link href="/dashboard">Dashboard</Link></li>
            <li><Link href="/test">Test suite</Link></li>
            <li><Link href="/dashboard/plans">Plans</Link></li>
          </ul>
        </div>
        <div className="invoq-footer-column">
          <h3>Developers</h3>
          <ul>
            <li><Link href="/signup">Get an API key</Link></li>
            <li><a href="https://github.com/RAJIV81205/Invoq" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><Link href="/test">API reference</Link></li>
          </ul>
        </div>
      </div>
      <div className="invoq-footer-base">
        <span>© {new Date().getFullYear()} Invoq</span>
        <span>Built on Stellar</span>
      </div>
    </footer>
  );
}
