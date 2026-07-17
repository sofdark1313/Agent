import {
  type RunAgentConversationTurnParams,
  runAgentConversationTurn,
} from "../turns/runAgentConversationTurn";
import {
  type RunTextConversationTurnParams,
  runTextConversationTurn,
} from "../turns/runTextConversationTurn";

export type ChatRuntimeHostTurn =
  | {
      mode: "agent";
      params: RunAgentConversationTurnParams;
    }
  | {
      mode: "text";
      params: RunTextConversationTurnParams;
    };

export type ChatRuntimeHost = {
  runTurn: (turn: ChatRuntimeHostTurn) => Promise<void>;
};

export function createChatRuntimeHost(): ChatRuntimeHost {
  return {
    async runTurn(turn) {
      if (turn.mode === "agent") {
        await runAgentConversationTurn(turn.params);
        return;
      }
      await runTextConversationTurn(turn.params);
    },
  };
}
