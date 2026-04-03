export type EntityLocation =
  | { type: "room"; roomId: string; x: number; y: number }
  | { type: "inventory" }
  | { type: "hidden"; roomId: string; x: number; y: number };

export interface Entity {
  id: string;
  name: string;
  description: string;
  location: EntityLocation;
  portable: boolean;
}

export class EntityManager {
  private entities = new Map<string, Entity>();

  // --- Query ---

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getEntitiesInRoom(roomId: string): Entity[] {
    return [...this.entities.values()].filter(
      (e) => e.location.type === "room" && e.location.roomId === roomId
    );
  }

  getInventory(): Entity[] {
    return [...this.entities.values()].filter(
      (e) => e.location.type === "inventory"
    );
  }

  getAllEntities(): Entity[] {
    return [...this.entities.values()];
  }

  isRevealed(entityId: string): boolean {
    const e = this.entities.get(entityId);
    if (!e) return false;
    return e.location.type === "room" || e.location.type === "inventory";
  }

  isInInventory(entityId: string): boolean {
    const e = this.entities.get(entityId);
    if (!e) return false;
    return e.location.type === "inventory";
  }

  // --- Mutations ---

  addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  revealEntity(entityId: string): void {
    const e = this.entities.get(entityId);
    if (e && e.location.type === "hidden") {
      e.location = { type: "room", roomId: e.location.roomId, x: e.location.x, y: e.location.y };
    }
  }

  moveToInventory(entityId: string): void {
    const e = this.entities.get(entityId);
    if (e) {
      e.location = { type: "inventory" };
    }
  }

  removeFromInventory(entityId: string): void {
    this.entities.delete(entityId);
  }

  moveToRoom(entityId: string, roomId: string, x: number, y: number): void {
    const e = this.entities.get(entityId);
    if (e) {
      e.location = { type: "room", roomId, x, y };
    }
  }

  setDescription(entityId: string, description: string): void {
    const e = this.entities.get(entityId);
    if (e) {
      e.description = description;
    }
  }
}
