/**
 * The All-LLM pause dialog's Continue action.
 *
 * An all-LLM room that crosses a turn threshold is paused and the dialog is
 * raised. Continue must do the two things its label promises, in order: lift
 * the pause (persisted, awaited) and then ask for the next turn. Bug 139 was a
 * Continue that only closed the dialog, leaving the room paused with no way to
 * restart it from there.
 */
export interface AllLLMContinueDeps {
  closeModal: () => void
  setPauseState: (paused: boolean) => Promise<void>
  handleContinue: () => Promise<void>
}

export async function continueAllLLMRoom({
  closeModal,
  setPauseState,
  handleContinue,
}: AllLLMContinueDeps): Promise<void> {
  closeModal()
  await setPauseState(false)
  await handleContinue()
}
