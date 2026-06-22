declare global {
  interface Window {
    electronAPI: {
      config: {
        get: () => Promise<any>;
        set: (key: string, value: any) => Promise<boolean>;
        setGlobalPassword: (pw: string) => Promise<boolean>;
        getGlobalPassword: () => Promise<string>;
      };
      ollama: {
        check: () => Promise<{ installed: boolean; running: boolean; models: any[] }>;
        install: () => Promise<{ success: boolean; message?: string }>;
        listModels: () => Promise<any[]>;
        pullModel: (name: string) => Promise<{ success: boolean }>;
        deleteModel: (name: string) => Promise<{ success: boolean }>;
        chat: (params: any) => Promise<{ content: string; model: string }>;
        getRunningModels: () => Promise<any[]>;
        loadCustomModel: (path: string) => Promise<{ success: boolean; modelName: string }>;
        onPullProgress: (cb: (data: any) => void) => () => void;
      };
      bot: {
        create: (config: any) => Promise<any>;
        connect: (id: string) => Promise<any>;
        disconnect: (id: string) => Promise<any>;
        delete: (id: string) => Promise<any>;
        sendChat: (id: string, msg: string) => Promise<void>;
        sendAIOnly: (id: string, msg: string) => Promise<void>;
        stopAction: (id: string) => Promise<any>;
        stopMovement: (id: string) => Promise<any>;
        startSurvivor: (id: string) => Promise<any>;
        stopSurvivor: (id: string) => Promise<any>;
        setNick: (id: string, nick: string) => Promise<any>;
        toggleAI: (id: string, enabled: boolean) => Promise<any>;
        getAll: () => Promise<any[]>;
        updateConfig: (id: string, config: any) => Promise<any>;
        testProxy: (proxy: string) => Promise<{ success: boolean; ip?: string; error?: string }>;
        triggerLobby: (id: string) => Promise<any>;
        startPvp: (id: string, opts?: any) => Promise<any>;
        stopPvp: (id: string) => Promise<any>;
        togglePvpMode: (id: string) => Promise<any>;
        clickItem: (id: string, slot: number, button?: number) => Promise<{ success: boolean }>;
        closeWindow: (id: string) => Promise<any>;
        startAnarchy: (id: string, opts?: any) => Promise<any>;
        stopAnarchy: (id: string) => Promise<any>;
        getAnarchyState: (id: string) => Promise<any>;
        startFarm: (id: string, opts?: any) => Promise<any>;
        stopFarm: (id: string) => Promise<any>;
      };
      proxy: {
        check: (proxy: string) => Promise<{ success: boolean; ip?: string; error?: string }>;
      };
      dialog: {
        openFile: () => Promise<string | null>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      anka: {
        list: () => Promise<any[]>;
        startRecording: (botId: string) => Promise<any>;
        addStep: (botId: string, step: any) => Promise<any>;
        stopRecording: (botId: string, info: any) => Promise<any>;
        cancelRecording: (botId: string) => Promise<any>;
        getStepCount: (botId: string) => Promise<number>;
        delete: (id: string) => Promise<any>;
        play: (botId: string, profileId: string) => Promise<any>;
        clickSlot: (botId: string, slot: number, button?: number) => Promise<any>;
      };
      on: (channel: string, cb: (data: any) => void) => () => void;
    };
  }
}

export {};
