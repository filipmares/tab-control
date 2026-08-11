export const TAB_EDIT_RETRY_LIMIT = 3;
export const TAB_EDIT_RETRY_BACKOFF = 60;
export const TAB_EDIT_LOCK_MESSAGE = "Tabs cannot be edited right now";

export function createTabEditRetry({
  retryLimit = TAB_EDIT_RETRY_LIMIT,
  backoff = TAB_EDIT_RETRY_BACKOFF,
  wait = defaultWait,
} = {}) {
  return async function runWithTabEditRetry(operation) {
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isTemporaryTabEditLock(error) || attempt === retryLimit) {
          throw error;
        }

        await wait(backoff * (attempt + 1));
      }
    }
  };
}

export function isTemporaryTabEditLock(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(TAB_EDIT_LOCK_MESSAGE);
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
