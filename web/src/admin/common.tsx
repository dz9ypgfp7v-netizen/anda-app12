import { ApiError, type J } from '../data/api';
import type { AppCtx } from '../app/state';

export type Target = 'logo' | 'banner' | 'merchant' | 'challenge' | 'reward';
const FOLDER: Record<Target, string> = { logo: 'config', banner: 'config', merchant: 'merchants', challenge: 'challenges', reward: 'rewards' };

/** Reduce la foto, la sube y la asigna. Si el servidor la rechaza, lanza el motivo. */
export async function uploadAndSetPhoto(app: AppCtx, file: File, target: Target, id: string | null): Promise<string> {
  const small = await app.backend.photos.prepare(file);
  const path = await app.backend.photos.upload(small, FOLDER[target], id ?? target);
  const r = await app.rpc<J>('admin_set_photo', { p_target: target, p_id: id, p_path: path });
  if (r?.ok === false) throw new ApiError(r.reason ?? 'foto_invalida');
  return path;
}

/** Valores para los <select> de estado de desafío. */
export const CHALLENGE_STATES = ['borrador', 'revision', 'programado', 'activo', 'pausado', 'finalizado'];

export const PERM_LABEL: Record<string, string> = {
  'desafios.editar': 'Crear y editar desafíos',
  'desafios.aprobar': 'Aprobar y activar desafíos',
  'catalogo.gestionar': 'Gestionar premios y catálogo',
  'fotos.gestionar': 'Cambiar fotos',
  'personas.ver': 'Ver personas',
  'visitas.ver': 'Ver visitas',
  'cupones.ver': 'Ver cupones',
  'auditoria.ver': 'Ver auditoría',
};

export const ACTION_LABEL: Record<string, string> = {
  enviar_revision: 'Enviar a revisión', solicitar_cambios: 'Pedir cambios', aprobar: 'Aprobar', activar: 'Activar',
  pausar: 'Pausar', reanudar: 'Reanudar', finalizar: 'Finalizar',
};

/** Acciones posibles según el estado del desafío (el servidor valida igual). */
export function actionsFor(status: string): string[] {
  switch (status) {
    case 'borrador': return ['enviar_revision', 'finalizar'];
    case 'revision': return ['aprobar', 'solicitar_cambios', 'finalizar'];
    case 'programado': return ['activar', 'pausar', 'finalizar'];
    case 'activo': return ['pausar', 'finalizar'];
    case 'pausado': return ['reanudar', 'finalizar'];
    default: return [];
  }
}
export const ACTION_PERM: Record<string, string> = {
  enviar_revision: 'desafios.editar', solicitar_cambios: 'desafios.aprobar', aprobar: 'desafios.aprobar', activar: 'desafios.aprobar',
  pausar: 'desafios.aprobar', reanudar: 'desafios.aprobar', finalizar: 'desafios.aprobar',
};
