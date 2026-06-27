import { useState, useEffect } from 'react';
import UserView from './UserView';
import AdminView from './AdminView';

function App() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check if ?admin=true is in URL or startapp=admin in Telegram initData
    const tg = (window as any).Telegram?.WebApp;
    const urlParams = new URLSearchParams(window.location.search);
    
    // Telegram passes startapp parameter in initDataUnsafe.start_param
    const startParam = tg?.initDataUnsafe?.start_param;
    
    if (urlParams.get('admin') === 'true' || startParam === 'admin') {
      setIsAdmin(true);
    }
  }, []);

  return isAdmin ? <AdminView /> : <UserView />;
}

export default App;
