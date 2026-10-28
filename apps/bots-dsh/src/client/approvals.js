// Whether an approval waits for the user: for a Bot, in any of its Sessions; for a group,
// from any of its members there. The sidebar, the header and the details panel all read it,
// so a Bot blocked on the user shows the same `alert` everywhere.
export const useApproval = (useWork, match) => (useWork ? useWork(work => (work.approvals ?? []).some(match)) : false)
