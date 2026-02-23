import { Router } from 'express';
import prisma from '../lib/db.js';
import { signToken, hashPassword, checkPassword, requireAuth } from '../lib/auth.js';

const router = Router();

// ── POST /api/auth/register ───────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, name, role = 'STUDENT', year, group, orgSlug } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Faltan campos requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

  try {
    // Buscar o crear organización de demo
    let org = await prisma.organization.findUnique({ where: { slug: orgSlug || 'demo' } });
    if (!org) {
      org = await prisma.organization.create({
        data: { name: orgSlug ? `Liceo ${orgSlug}` : 'Demo', slug: orgSlug || 'demo' }
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role, year, group, orgId: org.id }
    });

    const token = signToken({ id: user.id, role: user.role, orgId: user.orgId });
    res.json({ token, user: safeUser(user) });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Email ya registrado' });
    console.error(e);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await checkPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
    const token = signToken({ id: user.id, role: user.role, orgId: user.orgId });
    res.json({ token, user: safeUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: safeUser(user) });
});

function safeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

export default router;
