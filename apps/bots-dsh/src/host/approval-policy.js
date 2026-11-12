export function approvalPolicyOf(approval, session) {
  try {
    const policy = approval?.overrideOf?.(session) ?? approval?.config?.policy
    return policy === 'ask' || policy === 'never' ? policy : undefined
  } catch { return undefined }
}
