import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { LevelDefinition } from "../models/level.js";

const levels = new Map<string, LevelDefinition>();

export function loadLevels(levelsDir: string): void {
  const files = fs.readdirSync(levelsDir).filter((f) => f.endsWith(".yaml"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(levelsDir, file), "utf-8");
    const level = yaml.load(content) as LevelDefinition;
    levels.set(level.id, level);
  }
  console.log(`Loaded ${levels.size} levels`);
}

export function getLevel(id: string): LevelDefinition | undefined {
  return levels.get(id);
}

export function getAllLevels(): LevelDefinition[] {
  return Array.from(levels.values());
}
