import { useApp } from '../app/state';
import { Banner, Card, PhotoPicker } from '../ui/kit';
import { uploadAndSetPhoto } from './common';

export function Imagen() {
  const app = useApp();
  const { ctx, photo, reloadCtx } = app;
  return (
    <div className="col loose">
      <div className="section-title"><h1>Imagen y fotos</h1></div>
      <Banner tone="" icon="image">Las fotos se reducen automáticamente. Usá imágenes tuyas o con licencia: no subas material de terceros sin permiso.</Banner>
      <Card className="col">
        <b>Logo de ANDÁ</b>
        <div className="small muted">Se usa donde la app muestra el logo configurable.</div>
        <PhotoPicker path={ctx.config.logo_path} resolve={photo} label="Cambiar logo" size={72}
          onPick={async (f) => { await uploadAndSetPhoto(app, f, 'logo', null); await reloadCtx(); }} />
      </Card>
      <Card className="col">
        <b>Banner</b>
        <div className="small muted">Imagen de cabecera para campañas y portada.</div>
        <PhotoPicker path={ctx.config.banner_path} resolve={photo} label="Cambiar banner" size={72}
          onPick={async (f) => { await uploadAndSetPhoto(app, f, 'banner', null); await reloadCtx(); }} />
      </Card>
      <div className="small muted">Las fotos de comercios, desafíos y premios se cambian desde sus propias pantallas (Comercios, Desafíos y Premios).</div>
    </div>
  );
}
