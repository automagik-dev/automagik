// Wire projections from NousResearch/hermes-agent at
// 3bcd071226d3d605a2bb3b4f3933e7d583e189d6 (no schema-default hydration).
// methods_session.py::_create_session returns lazy info WITHOUT approval_mode/yolo.
// session_registry.py::_announce_built_agent later emits server.py::_session_info.
// session_registry.py::_live_session_payload uses session_key, NOT stored_session_id.
export function desktop8Session(sessionId, storedId) {
  const lazy = { model: 'sample-model', provider: 'sample', tools: {}, skills: {}, cwd: '', branch: null, project: null, lazy: true, desktop_contract: 8, profile_name: 'sample' }
  const { lazy: _, ...base } = lazy
  const info = { ...base, stored_session_id: storedId, approval_mode: 'manual', yolo: false, running: false, mcp_servers: [] }
  return {
    create: { session_id: sessionId, stored_session_id: storedId, message_count: 0, messages: [], info: lazy },
    info,
    live: { session_id: sessionId, session_key: storedId, message_count: 0, messages: [], messages_omitted: false, running: false, turn_started_at: null, started_at: 1, status: 'idle', info },
  }
}
