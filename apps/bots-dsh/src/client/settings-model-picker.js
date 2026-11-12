// The Settings > Bot model picker's wiring, apart from the form so a test can hold the
// crossing decision: a saved Bot asks first and sends a crossing to switchRoute, never an
// in-place updateBot; a same-route pick still updates the Bot's model.
export function settingsModelPicker({ bot, roster, actions, run, onFailure = () => () => {} }) {
  const pickModel = ref => run(actions.updateBot(bot.id, { model: ref }).catch(onFailure(ref)))
  const pickRoute = (ref, patch = {}) => run(actions.switchRoute(bot.id, ref, patch).catch(onFailure(ref)))
  const pick = (ref, { routeChange = false, effort } = {}) => (routeChange
    ? pickRoute(ref, effort === undefined ? {} : { effort })
    : (ref !== (bot.model ?? bot.appliedModel) || !bot.model ? pickModel(ref) : undefined))
  return { bot, roster, actions, run, saved: true, onPick: pick }
}
