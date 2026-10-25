import { Navigate, useLocation } from 'react-router-dom';
import { setSession, toast, useSession } from '@seats/frontend-shared';
import { paths } from '../../app/paths';
import { usePageTitle } from '../../app/usePageTitle';
import { LineChatMock } from './LineChatMock';
import { LineLoginDialog } from './LineLoginDialog';

/** The LINE chat of the venue's Official Account with its rich menu, and the LINE Login dialog over it. LINE Login
 *  is stubbed: the dialog takes a LINE user id (a fixed demo id when left empty), kept in this browser and sent as
 *  a demo fake-line bearer token on every call; real LINE ID tokens replace it later. Once allowed, the customer lands where they
 *  were going (the screen that sent them here), else on the concert rounds. */
export function LoginScreen() {
  const session = useSession();
  const location = useLocation();
  usePageTitle('Log in');
  const from = (location.state as { from?: string } | null)?.from;
  const target = from && from !== paths.login ? from : paths.rounds;
  if (session) return <Navigate to={target} replace />;

  const allow = (userId: string) => {
    setSession({ userId, role: 'customer', token: `fake-line-${userId}` });
    toast.success(`Logged in as ${userId}`);
  };
  const cancel = () => toast.info('Login cancelled. Log in to reserve a table.');

  return (
    <div className="line-chat">
      <LineChatMock />
      <LineLoginDialog onAllow={allow} onCancel={cancel} />
    </div>
  );
}
