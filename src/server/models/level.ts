export interface ChainStep {
  id: string;
  verb: string;
  target: string;
  on?: string; // for "USE key ON door"
  reveals?: string[];
  hint: string;
}

export interface RoomExit {
  direction: string;
  to: string; // room id or "exit" for level completion
  requires?: string; // chain step id that must be completed first
}

export type RoomCategory = "cell" | "open-air" | "shrine" | "flooded";

export interface RoomDefinition {
  id: string;
  name: string;
  description_hint: string;
  category: RoomCategory;
  width: number;  // 2-10
  height: number; // 2-10
  exits: RoomExit[];
  chain: ChainStep[];
}

export interface LevelDefinition {
  id: string;
  title: string;
  theme: string;
  mood: string;
  rooms: RoomDefinition[];
  start_room: string;
}
