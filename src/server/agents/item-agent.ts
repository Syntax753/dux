import type { RadialAction } from "../../shared/types.js";
import type { Entity } from "../services/entity-manager.js";
import type { ChainStep } from "../models/level.js";
import { callAgent } from "../services/llm-client.js";
import { ITEM_AGENT_SYSTEM } from "../prompts/item-agent-system.js";

export async function getItemActions(
  entity: Entity,
  inventory: Entity[],
  roomChain: ChainStep[],
  chainIndex: number
): Promise<RadialAction[]> {
  const inventoryDesc = inventory.map((e) => e.name).join(", ") || "empty";
  const currentStep =
    chainIndex < roomChain.length ? roomChain[chainIndex] : null;

  const userMessage = `The player wants to interact with:
- Object: ${entity.name} (id: ${entity.id})
- Description: ${entity.description}
- Portable: ${entity.portable}
- Currently in room (not in inventory)

Player inventory: ${inventoryDesc}

${currentStep ? `Current puzzle expects: ${currentStep.verb} ${currentStep.target}${currentStep.on ? ` on ${currentStep.on}` : ""}` : "Room puzzle is complete."}

What actions are available?`;

  const response = await callAgent(ITEM_AGENT_SYSTEM, [
    { role: "user", content: userMessage },
  ]);

  try {
    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(text) as { actions: RadialAction[] };
    return parsed.actions;
  } catch {
    // Fallback: basic action set
    const actions: RadialAction[] = [
      {
        action: "look",
        label: "Examine",
        description: `Look more closely at the ${entity.name}.`,
        enabled: true,
      },
    ];
    if (entity.portable) {
      actions.push({
        action: "get",
        label: "Pick Up",
        description: `Take the ${entity.name}.`,
        enabled: true,
      });
    }
    if (inventory.length > 0) {
      actions.push({
        action: "use",
        label: "Use Item",
        description: `Use an inventory item on the ${entity.name}.`,
        enabled: true,
      });
    }
    return actions;
  }
}
