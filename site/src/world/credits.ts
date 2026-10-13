// Every downloaded model on the island, with its author and licence (see public/world/CREDITS.md).
export interface ModelCredit {
  name: string
  author: string
  author_url: string
  model_url: string
  license: string
  license_url: string
  /** How it is used on the island. */
  use: string
}

/**
 * Downloaded (Creative Commons) models still on the island. Every building, tree, vehicle and prop is now an original
 * model made for this project, so the list is empty; the credits panel says so and lists any that come back.
 */
export const MODEL_CREDITS: ModelCredit[] = []
