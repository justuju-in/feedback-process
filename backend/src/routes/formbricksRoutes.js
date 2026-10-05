import { Router } from "express";
import { requireAuth } from "../controllers/authController.js";
import { respondWithError } from "../controllers/respondWithError.js";
import { openFormbricksSession, submitLocalFormbricksSession, syncFormbricksSession } from "../services/formbricksService.js";
import { createFormbricksForm } from "../services/formbricksBuilderService.js";
const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.post("/forms", async (req, res) => {
  try { res.status(201).json({ template: await createFormbricksForm(req.body, req.auth.user) }); }
  catch (error) { respondWithError(res, error); }
});
for (const [action, handler] of [["session", openFormbricksSession], ["sync", syncFormbricksSession]]) {
  router.post(`/requests/:id/${action}`, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid feedback request ID" });
    try { res.json(await handler(id, req.auth.user.id)); }
    catch (error) { respondWithError(res, error); }
  });
}
router.post("/requests/:id/local-submit", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "Invalid feedback request ID" });
  try { res.json(await submitLocalFormbricksSession(id, req.auth.user.id, req.body)); }
  catch (error) { respondWithError(res, error); }
});
export default router;
