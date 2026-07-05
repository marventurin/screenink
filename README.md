# ScreenInk

ScreenInk es una extension minima de GNOME Shell para dibujar encima del escritorio en Wayland durante videoconferencias, presentaciones, PDFs o navegador.

No usa Flutter, Electron, X11 ni dependencias npm. En GNOME Shell 50 usa `St.DrawingArea` para dibujar la capa transparente; no depende de la API Canvas de Clutter.

## Instalacion

Desde este directorio:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/screenink@omv
cp metadata.json extension.js stylesheet.css README.md ~/.local/share/gnome-shell/extensions/screenink@omv/
cp -r icons ~/.local/share/gnome-shell/extensions/screenink@omv/
```

Luego habilita la extension:

```bash
gnome-extensions enable screenink@omv
```

Tambien puedes habilitarla desde la app Extensions si esta instalada.

Para crear un paquete `.zip`, incluye la carpeta de iconos:

```bash
gnome-extensions pack -f --extra-source=icons .
```

## Recarga

Despues de modificar archivos dentro de `~/.local/share/gnome-shell/extensions/screenink@omv`, deshabilita y vuelve a habilitar la extension:

```bash
gnome-extensions disable screenink@omv
gnome-extensions enable screenink@omv
```

Si GNOME Shell no toma los cambios en Wayland, cierra sesion y vuelve a entrar.

## Activacion desde la barra superior

ScreenInk agrega un icono en la barra superior. Haz clic en el icono y usa `Activar`:

- `Activar` muestra la capa transparente y permite dibujar con mouse o lapiz.
- `Desactivar` oculta la capa y deja de capturar clics o teclado.

`Esc` tambien desactiva la capa de dibujo.

## Limpiar pantalla

Abre el menu de ScreenInk desde la barra superior y elige `Limpiar pantalla`.

## Deshacer

Abre el menu de ScreenInk desde la barra superior y elige `Deshacer ultimo trazo`.

## Ver logs si falla

Para ver errores de GNOME Shell relacionados con la extension:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Tambien puedes revisar el estado con:

```bash
gnome-extensions info screenink@omv
gnome-extensions list | grep screenink
```
