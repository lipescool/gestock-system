import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { User } from '../db/schema';
import { useT, useSetting } from '../store/settings';
import { useLock } from '../store/lock';
import InstallButton from './InstallButton';
import { Icon, type IconName } from '../lib/icons';
import './shell.css';

const NAV: { to: string; key: string; icon: IconName }[] = [
  { to: '/dashboard', key: 'nav.dashboard', icon: 'dashboard' },
  { to: '/pos', key: 'nav.pos', icon: 'register' },
  { to: '/stock', key: 'nav.stock', icon: 'stock' },
  { to: '/expenses', key: 'nav.expenses', icon: 'expenses' },
  { to: '/history', key: 'nav.history', icon: 'history' },
  { to: '/settings', key: 'nav.settings', icon: 'settings' },
];

export default function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const shopName = useSetting('shopName');
  const lock = useLock((s) => s.lock);

  /* Le bouton de verrouillage n'a de sens que si un code est défini :
     sans code, il mènerait à un écran que rien ne peut déverrouiller. */
  const protege = useLiveQuery(
    async () => (await db.users.filter((u) => u.active).toArray()).some((u) => u.pinHash),
    [], false,
  );

  /**
   * L'utilisateur courant, chargé une seule fois.
   *
   * En `useLiveQuery`, cette requête lisait la table `settings` : toute
   * écriture de réglage la renotifiait, et la coquille entière — donc
   * chaque page — se redessinait. Comme l'utilisateur ne change qu'à la
   * connexion, un chargement unique suffit.
   */
  const [user, setUser] = useState<User | undefined>();
  useEffect(() => {
    void (async () => {
      const id = (await db.settings.get('currentUserId'))?.value as string | undefined;
      setUser(id ? await db.users.get(id) : undefined);
    })();
  }, []);

  return (
    <div className="shell">
      <header className="topbar no-print">
        <div className="brand">
          <span className="logo" aria-hidden>◠◡◠</span>
          <span className="brand-name">{shopName}</span>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}
                     className={({ isActive }) => `nav-item ${isActive ? 'on' : ''}`}>
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={17} inherit={isActive} />
                  <span className="nav-label">{t(item.key)}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <InstallButton />

        <div className="user">
          <div className="avatar" aria-hidden>
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="user-meta">
            <b>{user?.name ?? ''}</b>
            <small>{user ? t(`role.${user.role}`) : ''}</small>
          </div>

          {/* Verrouiller en quittant le comptoir : sans ce bouton, il
              faudrait fermer l'application pour que le code soit
              redemandé. */}
          {protege && (
            <button className="lock-btn" onClick={lock} title={t('lock.lockNow')}>
              <Icon name="lock" size={16} />
              {/* Le mot accompagne l'icône : seule, elle passait
                  inaperçue dans la barre. Il s'efface sur les écrans
                  étroits, où la place manque. */}
              <span>{t('lock.lock')}</span>
            </button>
          )}
        </div>
      </header>

      <main className="content">{children}</main>

      {/* Sur téléphone, la navigation descend en bas : c'est là que le pouce
          se trouve, et la barre du haut deviendrait illisible. */}
      <nav className="tabbar no-print">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to}
                   className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>
            {({ isActive }) => (
              <>
                <Icon name={item.icon} size={19} inherit={isActive} />
                <small>{t(item.key)}</small>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
