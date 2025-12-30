/**
 * Event Routes
 *
 * HTTP endpoints for Claude Code hooks to report events to the daemon.
 * These are called by shell scripts in ~/.claude/hooks/
 */

const express = require('express');

/**
 * Create event routes
 *
 * @param {object} options
 * @param {SessionRegistry} options.registry - Session registry instance
 * @param {object} options.logger - Logger instance
 * @param {function} options.onStop - Callback when Stop event fires (for notifications)
 * @returns {express.Router}
 */
function createEventRoutes(options) {
    const { registry, logger, onStop } = options;
    const router = express.Router();

    /**
     * POST /events/session-start
     *
     * Called by on-session-start.sh hook when Claude Code starts.
     * Registers the session with notify=false by default.
     *
     * Body:
     *   - session_id: string (required) - Claude's session ID
     *   - ppid: number - Parent process ID
     *   - pid: number - Process ID
     *   - cwd: string - Working directory
     *   - nvim_socket: string - Neovim socket path (if in nvim terminal)
     *   - tmux_session: string - Tmux session name (if in tmux)
     *   - notify: boolean - Whether to send notifications (default: false)
     */
    router.post('/session-start', (req, res) => {
        try {
            const { session_id, ppid, pid, start_time, cwd, nvim_socket, tmux_session, tmux_pane, notify, label } = req.body;

            if (!session_id) {
                return res.status(400).json({ error: 'session_id is required' });
            }

            const session = registry.upsertSession({
                session_id,
                ppid: ppid ? Number(ppid) : undefined,
                pid: pid ? Number(pid) : undefined,
                start_time: start_time ? Number(start_time) : undefined,
                cwd,
                nvim_socket,
                tmux_session,
                tmux_pane,
                notify: notify ?? false,
                label: label || undefined,
            });

            logger.info?.(`Session started: ${session_id}`) ||
                logger.log?.(`Session started: ${session_id}`);

            res.json({ ok: true, session_id: session.session_id });
        } catch (error) {
            logger.error?.(`Error in /events/session-start: ${error.message}`) ||
                logger.log?.(`Error in /events/session-start: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /events/stop
     *
     * Called by on-stop.sh hook when Claude Code task completes.
     * If session has notify=true, triggers Telegram notification.
     *
     * Body:
     *   - session_id: string (required)
     *   - event: string - "Stop" or "SubagentStop"
     *   - summary: string - Brief description of what completed
     *   - label: string - Override label for this notification
     */
    router.post('/stop', async (req, res) => {
        try {
            // Note: on-stop.sh sends 'message', we accept both 'message' and 'summary'
            const { session_id, event, summary, message, label } = req.body;

            if (!session_id) {
                return res.status(400).json({ error: 'session_id is required' });
            }

            const session = registry.getSession(session_id);

            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            // Update session state
            registry.touchSession(session_id);

            // Only notify if opted in
            if (!session.notify) {
                logger.debug?.(`Stop event for ${session_id} - notifications disabled`) ||
                    logger.log?.(`Stop event for ${session_id} - notifications disabled`);
                return res.json({ ok: true, notified: false, reason: 'notify=false' });
            }

            // Trigger notification callback
            if (onStop) {
                try {
                    const result = await onStop({
                        session,
                        event: event || 'Stop',
                        summary: message || summary || 'Task completed',
                        label: label || session.label,
                    });
                    res.json({ ok: true, notified: true, ...result });
                } catch (notifyError) {
                    logger.error?.(`Notification failed: ${notifyError.message}`) ||
                        logger.log?.(`Notification failed: ${notifyError.message}`);
                    res.json({ ok: true, notified: false, error: notifyError.message });
                }
            } else {
                res.json({ ok: true, notified: false, reason: 'no notification handler' });
            }
        } catch (error) {
            logger.error?.(`Error in /events/stop: ${error.message}`) ||
                logger.log?.(`Error in /events/stop: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /sessions/enable-notify
     *
     * Called by /notify slash command to opt a session into notifications.
     *
     * Body:
     *   - session_id: string (required)
     *   - label: string - Human-friendly label
     *   - nvim_socket: string - Neovim socket path (optional update)
     */
    router.post('/sessions/enable-notify', (req, res) => {
        try {
            const { session_id, label, nvim_socket } = req.body;

            if (!session_id) {
                return res.status(400).json({ error: 'session_id is required' });
            }

            const session = registry.enableNotify(session_id, label, { nvim_socket });

            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            logger.info?.(`Notifications enabled for: ${session_id} (${label})`) ||
                logger.log?.(`Notifications enabled for: ${session_id} (${label})`);

            res.json({ ok: true, session });
        } catch (error) {
            logger.error?.(`Error in /sessions/enable-notify: ${error.message}`) ||
                logger.log?.(`Error in /sessions/enable-notify: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /sessions
     *
     * List active sessions. For Telegram /sessions command.
     *
     * Query params:
     *   - active: boolean - Only show active (running, non-expired) sessions
     *   - notify: boolean - Only show sessions with notify=true
     */
    router.get('/sessions', (req, res) => {
        try {
            const sessions = registry.listSessions({
                activeOnly: req.query.active === 'true',
                notifyOnly: req.query.notify === 'true',
            });

            res.json({ ok: true, sessions });
        } catch (error) {
            logger.error?.(`Error in GET /sessions: ${error.message}`) ||
                logger.log?.(`Error in GET /sessions: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /sessions/:sessionId
     *
     * Get a specific session by ID.
     */
    router.get('/sessions/:sessionId', (req, res) => {
        try {
            const session = registry.getSession(req.params.sessionId);

            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            res.json({ ok: true, session });
        } catch (error) {
            logger.error?.(`Error in GET /sessions/:id: ${error.message}`) ||
                logger.log?.(`Error in GET /sessions/:id: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * DELETE /sessions/:sessionId
     *
     * Delete a session.
     */
    router.delete('/sessions/:sessionId', (req, res) => {
        try {
            registry.deleteSession(req.params.sessionId);
            res.json({ ok: true });
        } catch (error) {
            logger.error?.(`Error in DELETE /sessions/:id: ${error.message}`) ||
                logger.log?.(`Error in DELETE /sessions/:id: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /sessions/:sessionId/heartbeat
     *
     * Update last_seen for a session (keepalive).
     */
    router.post('/sessions/:sessionId/heartbeat', (req, res) => {
        try {
            registry.touchSession(req.params.sessionId);
            res.json({ ok: true });
        } catch (error) {
            logger.error?.(`Error in heartbeat: ${error.message}`) ||
                logger.log?.(`Error in heartbeat: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /tokens/validate
     *
     * Validate a token for Telegram command handling.
     *
     * Body:
     *   - token: string (required)
     *   - chat_id: string|number (required)
     */
    router.post('/tokens/validate', (req, res) => {
        try {
            const { token, chat_id } = req.body;

            if (!token || !chat_id) {
                return res.status(400).json({ error: 'token and chat_id are required' });
            }

            const result = registry.validateToken(token, chat_id);
            res.json(result);
        } catch (error) {
            logger.error?.(`Error in /tokens/validate: ${error.message}`) ||
                logger.log?.(`Error in /tokens/validate: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /cleanup
     *
     * Trigger cleanup of expired sessions and tokens.
     */
    router.post('/cleanup', (req, res) => {
        try {
            const expiredSessions = registry.cleanupExpiredSessions();
            const expiredTokens = registry.cleanupExpiredTokens();

            res.json({
                ok: true,
                cleaned: {
                    sessions: expiredSessions,
                    tokens: expiredTokens,
                },
            });
        } catch (error) {
            logger.error?.(`Error in /cleanup: ${error.message}`) ||
                logger.log?.(`Error in /cleanup: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = { createEventRoutes };
