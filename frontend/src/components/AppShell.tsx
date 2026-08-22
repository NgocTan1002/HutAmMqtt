import type { ReactNode } from 'react';
import logoUrl from '../../../favicon.svg';

export type AppPage = 'dashboard' | 'devices';

export function AppShell({ page, onNavigate, collapsed, onToggle, children }: {
  page: AppPage;
  onNavigate(page: AppPage): void;
  collapsed: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="brand"><img className="brand-logo" src={logoUrl} alt="Logo hệ thống" /><strong>Máy hút ẩm</strong></div>
          <button aria-expanded={!collapsed} aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} className="sidebar-toggle" onClick={onToggle} title={collapsed ? 'Mở rộng' : 'Thu gọn'} type="button"><span aria-hidden="true">{collapsed ? '›' : '‹'}</span></button>
        </div>
        <nav aria-label="Điều hướng chính">
          <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => onNavigate('dashboard')} type="button">Tổng quan</button>
          <button className={`nav-item ${page === 'devices' ? 'active' : ''}`} onClick={() => onNavigate('devices')} type="button">Thiết bị</button>
        </nav>
      </aside>
      <main className="dashboard">{children}</main>
    </div>
  );
}
