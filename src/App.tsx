import { useState } from 'react';
import type { Session } from './types/opro';
import { SessionManager } from './components/SessionManager';
import { OPROWorkspace } from './components/OPROWorkspace';

function App() {
    const [currentSession, setCurrentSession] = useState<Session | null>(null);

    const handleSelectSession = (session: Session) => {
        setCurrentSession(session);
    };

    const handleBackToSessions = () => {
        setCurrentSession(null);
    };

    return (
        <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
            <h1>OPRO - Optimization by PROmpting</h1>

            {!currentSession ? (
                <SessionManager onSelectSession={handleSelectSession} />
            ) : (
                <OPROWorkspace session={currentSession} onBack={handleBackToSessions} />
            )}
        </div>
    );
}

export default App;