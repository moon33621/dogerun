export type TelegramStatus = {
  linked: boolean;
  username: string | null;
  request: any;
  preview: any;
  adminReady: boolean;
  inbox: any[];
};

export function startTelegramBot() {}

export function parseBotCommand(_text: string) {
  return { command: "", args: [] as string[] };
}

export function parseCallback(_data: string) {
  return { action: "", payload: "" };
}
