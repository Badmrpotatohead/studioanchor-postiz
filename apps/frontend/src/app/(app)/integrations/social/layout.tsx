import { ReactNode } from 'react';

export default async function IntegrationLayout({
  children,
}: {
  children: ReactNode;
}) {
  // connect-return-v1: the StudioAnchor connect screens draw their own page.
  if (process.env.POSTIZ_CONNECT_RETURN_ORIGINS) {
    return <div className="flex flex-1 min-h-screen w-screen">{children}</div>;
  }
  return (
    <div className="bg-[#0B0A0A] flex flex-1 min-h-screen w-screen">
      {children}
    </div>
  );
}
