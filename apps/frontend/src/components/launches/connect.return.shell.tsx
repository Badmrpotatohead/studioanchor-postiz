'use client';

// connect-return-v1: the account-connect screens a StudioAnchor workspace
// owner sees when POSTIZ_CONNECT_RETURN_ORIGINS is configured. Styles are
// inline so the app's dark theme does not apply to these screens.
import { FC, ReactNode, useEffect } from 'react';

export interface ConnectReturnTargets {
  connected: string;
  failed: string;
}

const colors = {
  page: '#f6f3ec',
  card: '#ffffff',
  navy: '#16264f',
  slate: '#4a5568',
  rose: '#7d2742',
  success: '#4a7860',
  border: '#e5edf7',
};

const ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16264f"/><path d="M16 7v15m-6-4a6 6 0 0 0 12 0M12 11h8" stroke="#f6a8c0" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>'
  );

export const isConnectReturnTargets = (
  value: unknown
): value is ConnectReturnTargets =>
  !!value &&
  typeof (value as ConnectReturnTargets).connected === 'string' &&
  typeof (value as ConnectReturnTargets).failed === 'string';

const useStudioAnchorDocument = () => {
  useEffect(() => {
    document.title = 'StudioAnchor';
    document
      .querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
      .forEach((link) => {
        link.href = ICON;
      });
    document.body.style.setProperty('background', colors.page, 'important');
  }, []);
};

export const ConnectReturnShell: FC<{
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'success' | 'error';
  wide?: boolean;
}> = ({ title, children, tone = 'neutral', wide = false }) => {
  useStudioAnchorDocument();
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: colors.page,
        color: colors.navy,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <main
        style={{
          width: '100%',
          maxWidth: wide ? 560 : 440,
          background: colors.card,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 12px 32px rgba(22, 38, 79, 0.08)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontWeight: 800,
            fontSize: 15,
            letterSpacing: 0.2,
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 32 32" width={28} height={28}>
            <rect width="32" height="32" rx="8" fill={colors.navy} />
            <path
              d="M16 7v15m-6-4a6 6 0 0 0 12 0M12 11h8"
              stroke="#f6a8c0"
              strokeWidth="2.6"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          StudioAnchor
        </div>
        <h1
          style={{
            marginTop: 24,
            fontSize: 24,
            lineHeight: '32px',
            fontWeight: 800,
            color:
              tone === 'success'
                ? colors.success
                : tone === 'error'
                ? colors.rose
                : colors.navy,
          }}
        >
          {title}
        </h1>
        <div
          style={{
            marginTop: 12,
            fontSize: 15,
            lineHeight: '24px',
            color: colors.slate,
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
};

// Shown once the connect outcome is known, then returns to StudioAnchor.
export const ConnectReturnComplete: FC<{ ok: boolean; url: string }> = ({
  ok,
  url,
}) => {
  useEffect(() => {
    const timer = setTimeout(() => window.location.replace(url), 1200);
    return () => clearTimeout(timer);
  }, [url]);
  return (
    <ConnectReturnShell
      title={ok ? 'Account connected' : 'The account was not connected'}
      tone={ok ? 'success' : 'error'}
    >
      <p>
        {ok
          ? 'Returning you to StudioAnchor Marketing to finish setup.'
          : 'Nothing was changed. Returning you to StudioAnchor Marketing so you can try again.'}
      </p>
      <p style={{ marginTop: 20 }}>
        <a
          href={url}
          style={{
            display: 'inline-block',
            minHeight: 44,
            lineHeight: '44px',
            padding: '0 20px',
            borderRadius: 999,
            background: colors.navy,
            color: '#ffffff',
            fontWeight: 700,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Continue to StudioAnchor
        </a>
      </p>
    </ConnectReturnShell>
  );
};
