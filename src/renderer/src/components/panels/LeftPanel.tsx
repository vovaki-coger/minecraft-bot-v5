import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import BotControls from '../BotControls';
import ModelsTab from '../tabs/ModelsTab';
import SettingsTab from '../tabs/SettingsTab';
import CoordinatorTab from '../tabs/CoordinatorTab';
import AnarchyTab from '../tabs/AnarchyTab';
import FarmTab from '../tabs/FarmTab';
import PvpTab from '../tabs/PvpTab';
import LogsTab from '../tabs/LogsTab';
import BotEditModal from '../BotEditModal';

export default function LeftPanel() {
  const { activeTab, bots, selectedBotId } = useAppStore();
  const selectedBot = bots.find((b) => b.id === selectedBotId) || null;
  const [editOpen, setEditOpen] = useState(false);

  const content = () => {
    switch (activeTab) {
      case 'models':      return <ModelsTab />;
      case 'settings':    return <SettingsTab />;
      case 'coordinator': return <CoordinatorTab />;
      case 'anarchy':     return <AnarchyTab />;
      case 'farm':        return <FarmTab bot={selectedBot} />;
      case 'pvp':         return <PvpTab />;
      case 'logs':        return <LogsTab />;
      default:
        return (
          <div className='flex flex-col h-full overflow-hidden'>
            <div className='px-3 py-2 border-b text-xs font-mono'
              style={{ borderColor: '#3a3a3a', color: '#7ecc49' }}>
              Управление ботом
            </div>
            <div className='flex-1 overflow-y-auto p-2'>
              {selectedBot ? (
                <>
                  <div className='panel p-2 mb-2'>
                    <div className='flex items-start justify-between'>
                      <div className='flex-1 min-w-0'>
                        <div className='text-xs mb-0.5' style={{ color: '#888' }}>Активный бот</div>
                        <div className='text-sm font-mono truncate' style={{ color: '#7ecc49' }}>
                          {selectedBot.config.nick}
                        </div>
                        <div className='text-xs mt-0.5 truncate' style={{ color: '#555' }}>
                          {selectedBot.config.host}:{selectedBot.config.port} · v{selectedBot.config.version}
                        </div>
                        <div className='text-xs truncate' style={{ color: '#555' }}>
                          ИИ: {selectedBot.config.aiModel?.split(':')[0] || '—'}
                        </div>
                      </div>
                      <button
                        className='btn text-xs ml-2 flex-shrink-0'
                        onClick={() => setEditOpen(true)}
                        title='Редактировать настройки бота'
                        style={{ padding: '3px 8px', fontSize: 11 }}
                      >
                        ✏️ Изменить
                      </button>
                    </div>
                  </div>
                  <BotControls bot={selectedBot} />
                </>
              ) : (
                <div className='text-xs text-center mt-8' style={{ color: '#555' }}>
                  Создайте или выберите бота
                </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <div
        className='panel flex-shrink-0'
        style={{
          width: 290,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(30,30,30,0.92)',
        }}
      >
        {content()}
      </div>
      {editOpen && selectedBot && (
        <BotEditModal bot={selectedBot} onClose={() => setEditOpen(false)} />
      )}
    </>
  );
}
