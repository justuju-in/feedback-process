import {nativeBuilderConfig,listNativeForms,useNativeForm} from "../services/formbricksNativeService.js";
import { Router } from "express";
import { requireAuth } from "../controllers/authController.js";
import { respondWithError } from "../controllers/respondWithError.js";
import { formbricksConfig, formbricksGet } from "../integrations/formbricks.js";
import { connectFormbricksTemplate, openFormbricksSession, syncFormbricksSession } from "../services/formbricksService.js";

import { createFormbricksForm } from "../services/formbricksBuilderService.js";

const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const moderator = (req, res, next) => ["admin", "hr", "sc"].includes(String(req.auth.user.role).toLowerCase()) ? next() : res.status(403).json({ message: "Only administrators, HR and SC can connect Formbricks surveys" });
router.get("/config", (_req, res) => {
  try { const { origin, configured } = formbricksConfig(); res.json({ origin, configured, builder: nativeBuilderConfig() }); }
  catch (error) { respondWithError(res, error); }
});
router.get("/builder/forms", async(req,res)=>{
 try{res.json({forms:await listNativeForms(req.auth.user,req.cookies)});}catch(error){respondWithError(res,error);}
});
router.post("/builder/use", async(req,res)=>{
 try{res.json({template:await useNativeForm(req.body,req.auth.user,req.cookies)});}catch(error){respondWithError(res,error);}
});
router.post("/test", moderator, async (_req, res) => {
  try { await formbricksGet("me"); res.json({ connected: true }); }
  catch (error) { respondWithError(res, error); }
});
router.post("/forms", async (req, res) => {
  try { res.status(201).json({template: await createFormbricksForm(req.body, req.auth.user)}); }
  catch (error) { respondWithError(res, error); }
});
router.post("/templates", moderator, async (req, res) => {
  try { res.status(201).json({ template: await connectFormbricksTemplate({ survey: req.body.survey, name: req.body.name, actorId: req.auth.user.id }) }); }
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
export default router;
