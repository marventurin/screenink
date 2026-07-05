import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const INK_COLORS = {
    green: [0.1, 0.9, 0.25, 1],
    red: [1, 0.1, 0.1, 1],
    yellow: [1, 0.85, 0.05, 1],
    white: [1, 1, 1, 1],
};

const STROKE_WIDTH_PRESETS = [3, 5, 8, 12, 18];
const STROKE_WIDTH_INITIAL = 5;
const PANEL_ICON_SIZE = 18;
const MENU_ICON_SIZE = 30;
const MENU_ICON_COLUMN_WIDTH = 32;
const MENU_CLOSE_DELAY_MS = 250;
const ARROW_HEAD_MIN_SIZE = 12;
const ARROW_HEAD_WIDTH_MULTIPLIER = 4;
const ARROW_HEAD_ANGLE = Math.PI / 7;
const TWO_PI = 2 * Math.PI;

const Tool = Object.freeze({
    FREE: 'free',
    RECT: 'rect',
    ELLIPSE: 'ellipse',
    ARROW: 'arrow',
});

const InkLayer = GObject.registerClass(
class InkLayer extends St.DrawingArea {
    _init() {
        super._init({
            name: 'screenink-layer',
            reactive: false,
            can_focus: true,
            track_hover: false,
            visible: false,
        });

        this._strokes = [];
        this._currentStroke = null;
        this._color = INK_COLORS.green;
        this._strokeWidth = STROKE_WIDTH_INITIAL;
        this._tool = Tool.FREE;
        this._colorChangedCallback = null;
        this._toolChangedCallback = null;
        this._strokeWidthChangedCallback = null;

        this.connect('repaint', this._onRepaint.bind(this));
        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('motion-event', this._onMotion.bind(this));
        this.connect('button-release-event', this._onButtonRelease.bind(this));
        this.connect('key-press-event', this._onKeyPress.bind(this));
        this.resizeToStage();
    }

    resizeToStage() {
        const width = global.stage.width;
        const panelHeight = Main.panel?.height ?? 0;
        const height = Math.max(global.stage.height - panelHeight, 1);

        this._offsetY = panelHeight;
        this.set_position(0, panelHeight);
        this.set_size(width, height);
        this._invalidate();
    }

    setInkColor(color) {
        this._color = color;
        this._colorChangedCallback?.(color);
    }

    setColorChangedCallback(callback) {
        this._colorChangedCallback = callback;
    }

    setTool(tool) {
        this._tool = tool;
        this._currentStroke = null;
        this._invalidate();
        this._toolChangedCallback?.(tool);
    }

    setToolChangedCallback(callback) {
        this._toolChangedCallback = callback;
    }

    setStrokeWidth(width) {
        if (!STROKE_WIDTH_PRESETS.includes(width))
            return;

        this._strokeWidth = width;
        this._strokeWidthChangedCallback?.(width);
    }

    setStrokeWidthChangedCallback(callback) {
        this._strokeWidthChangedCallback = callback;
    }

    undo() {
        this._strokes.pop();
        this._invalidate();
    }

    clear() {
        this._strokes = [];
        this._currentStroke = null;
        this._invalidate();
    }

    startDrawing() {
        this.resizeToStage();
        this.reactive = true;
        this.show();
        this.grab_key_focus();
    }

    stopDrawing() {
        this.reactive = false;
        this.hide();
        this._currentStroke = null;
    }

    _invalidate() {
        this.queue_repaint();
    }

    _onRepaint(area) {
        const cr = area.get_context();

        try {
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);

            for (const stroke of this._strokes)
                this._drawStroke(cr, stroke);

            if (this._currentStroke)
                this._drawStroke(cr, this._currentStroke);
        } finally {
            cr.$dispose();
        }
    }

    _drawStroke(cr, stroke) {
        if (stroke.points.length === 0)
            return;

        cr.setSourceRGBA(...stroke.color);
        cr.setLineWidth(stroke.width);

        switch (stroke.type) {
        case Tool.RECT:
            this._drawRectStroke(cr, stroke);
            break;
        case Tool.ELLIPSE:
            this._drawEllipseStroke(cr, stroke);
            break;
        case Tool.ARROW:
            this._drawArrowStroke(cr, stroke);
            break;
        case Tool.FREE:
        default:
            this._drawFreeStroke(cr, stroke);
            break;
        }
    }

    _drawFreeStroke(cr, stroke) {
        cr.moveTo(stroke.points[0].x, stroke.points[0].y);

        for (const point of stroke.points.slice(1))
            cr.lineTo(point.x, point.y);

        cr.stroke();
    }

    _drawRectStroke(cr, stroke) {
        if (stroke.points.length < 2)
            return;

        const [p1, p2] = stroke.points;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const width = Math.abs(p2.x - p1.x);
        const height = Math.abs(p2.y - p1.y);

        cr.rectangle(x, y, width, height);
        cr.stroke();
    }

    _drawEllipseStroke(cr, stroke) {
        if (stroke.points.length < 2)
            return;

        const [p1, p2] = stroke.points;
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const rx = Math.abs(p2.x - p1.x) / 2;
        const ry = Math.abs(p2.y - p1.y) / 2;

        if (rx === 0 || ry === 0)
            return;

        cr.save();
        cr.translate(cx, cy);
        cr.scale(rx, ry);
        cr.arc(0, 0, 1, 0, TWO_PI);
        cr.restore();
        cr.stroke();
    }

    _drawArrowStroke(cr, stroke) {
        if (stroke.points.length < 2)
            return;

        const [p1, p2] = stroke.points;
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        if (!Number.isFinite(angle))
            return;

        cr.moveTo(p1.x, p1.y);
        cr.lineTo(p2.x, p2.y);
        cr.stroke();

        const headSize = Math.max(
            ARROW_HEAD_MIN_SIZE,
            stroke.width * ARROW_HEAD_WIDTH_MULTIPLIER
        );
        const leftAngle = angle + Math.PI - ARROW_HEAD_ANGLE;
        const rightAngle = angle + Math.PI + ARROW_HEAD_ANGLE;
        const left = {
            x: p2.x + Math.cos(leftAngle) * headSize,
            y: p2.y + Math.sin(leftAngle) * headSize,
        };
        const right = {
            x: p2.x + Math.cos(rightAngle) * headSize,
            y: p2.y + Math.sin(rightAngle) * headSize,
        };

        cr.moveTo(p2.x, p2.y);
        cr.lineTo(left.x, left.y);
        cr.lineTo(right.x, right.y);
        cr.closePath();
        cr.fill();
    }

    _eventPoint(event) {
        const [x, y] = event.get_coords();

        return {x, y: y - this._offsetY};
    }

    _onButtonPress(actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        this._currentStroke = {
            type: this._tool,
            color: [...this._color],
            width: this._strokeWidth,
            points: [this._eventPoint(event)],
        };
        this._invalidate();

        return Clutter.EVENT_STOP;
    }

    _onMotion(actor, event) {
        if (!this._currentStroke)
            return Clutter.EVENT_PROPAGATE;

        const point = this._eventPoint(event);

        if (this._currentStroke.type === Tool.FREE)
            this._currentStroke.points.push(point);
        else
            this._currentStroke.points[1] = point;

        this._invalidate();

        return Clutter.EVENT_STOP;
    }

    _onButtonRelease(actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY || !this._currentStroke)
            return Clutter.EVENT_PROPAGATE;

        const point = this._eventPoint(event);

        if (this._currentStroke.type === Tool.FREE)
            this._currentStroke.points.push(point);
        else
            this._currentStroke.points[1] = point;

        this._strokes.push(this._currentStroke);
        this._currentStroke = null;
        this._invalidate();

        return Clutter.EVENT_STOP;
    }

    _onKeyPress(actor, event) {
        const key = event.get_key_symbol();

        switch (key) {
        case Clutter.KEY_r:
        case Clutter.KEY_R:
            this.setTool(Tool.RECT);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_e:
        case Clutter.KEY_E:
            this.setTool(Tool.ELLIPSE);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_f:
        case Clutter.KEY_F:
            this.setTool(Tool.ARROW);
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

});

export default class ScreenInkExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.5, 'ScreenInk', false);
        this._indicator.add_child(this._createIcon('bar.svg', PANEL_ICON_SIZE, {
            style_class: 'system-status-icon screenink-panel-icon',
            style: `icon-size: ${PANEL_ICON_SIZE}px;`,
        }));

        this._inkLayer = new InkLayer();
        Main.layoutManager.addChrome(this._inkLayer, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        this._signals = [];
        this._signals.push([
            global.stage,
            global.stage.connect('notify::width', () => this._inkLayer.resizeToStage()),
        ]);
        this._signals.push([
            global.stage,
            global.stage.connect('notify::height', () => this._inkLayer.resizeToStage()),
        ]);
        this._drawingEnabled = false;
        this._menuCloseTimeoutId = 0;
        this._menuReopenIdleId = 0;
        this._activeInkColor = INK_COLORS.green;
        this._activeTool = Tool.FREE;
        this._activeStrokeWidth = STROKE_WIDTH_INITIAL;
        this._colorItems = new Map();
        this._toolItems = new Map();
        this._strokeWidthItems = new Map();
        this._strokeWidthPreviews = new Set();
        this._inkLayer.setColorChangedCallback(color => {
            this._activeInkColor = color;
            this._syncColorItems();
            this._syncStrokeWidthPreviews();
        });
        this._inkLayer.setToolChangedCallback(tool => {
            this._activeTool = tool;
            this._syncToolItems();
        });
        this._inkLayer.setStrokeWidthChangedCallback(width => {
            this._activeStrokeWidth = width;
            this._syncStrokeWidthItems();
        });
        this._buildMenu();
        this._setupMenuPointerTracking();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._clearMenuTimers();

        if (this._signals) {
            for (const [object, id] of this._signals)
                object.disconnect(id);
            this._signals = null;
        }

        if (this._inkLayer) {
            this._inkLayer.setColorChangedCallback(null);
            this._inkLayer.setToolChangedCallback(null);
            this._inkLayer.setStrokeWidthChangedCallback(null);
            Main.layoutManager.removeChrome(this._inkLayer);
            this._inkLayer.destroy();
            this._inkLayer = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._drawingItem = null;
        this._drawingLabel = null;
        this._drawingIconBox = null;
        this._menuCloseTimeoutId = 0;
        this._menuReopenIdleId = 0;
        this._colorItems = null;
        this._toolItems = null;
        this._strokeWidthItems = null;
        this._strokeWidthPreviews = null;
        this._drawingEnabled = false;
        this._activeInkColor = INK_COLORS.green;
        this._activeTool = Tool.FREE;
        this._activeStrokeWidth = STROKE_WIDTH_INITIAL;
    }

    _iconPath(fileName) {
        return `${this.path}/icons/${fileName}`;
    }

    _createIcon(fileName, size, params = {}) {
        const path = this._iconPath(fileName);

        return new St.Icon({
            gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}),
            icon_size: size,
            width: size,
            height: size,
            ...params,
        });
    }

    _createMenuRow(label, icon) {
        const box = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const iconBox = new St.Bin({
            child: icon,
            width: MENU_ICON_COLUMN_WIDTH,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 10px;',
        });
        const textLabel = new St.Label({
            text: label,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        textLabel.clutter_text.set_line_wrap(false);
        box.add_child(iconBox);
        box.add_child(textLabel);

        return {row: box, label: textLabel, iconBox};
    }

    _setupMenuPointerTracking() {
        const menuActor = this._indicator.menu.actor ?? this._indicator.menu.box;

        if (!menuActor)
            return;

        menuActor.reactive = true;
        menuActor.track_hover = true;

        this._signals.push([
            menuActor,
            menuActor.connect('leave-event', () => {
                this._scheduleMenuClose();
                return Clutter.EVENT_PROPAGATE;
            }),
        ]);
    }

    _withMenuKeptOpen(callback) {
        const menuBounds = this._menuWindowBounds();
        const shouldKeepOpen = this._isPointerInBounds(menuBounds);

        callback();

        if (shouldKeepOpen)
            this._scheduleMenuReopen(menuBounds);
    }

    _isPointerOverMenuWindow() {
        return this._isPointerOverActor(this._indicator?.menu?.actor) ||
            this._isPointerOverActor(this._indicator?.menu?.box) ||
            this._isPointerOverActor(this._indicator);
    }

    _menuWindowBounds() {
        return this._combineBounds(
            this._actorBounds(this._indicator?.menu?.actor),
            this._actorBounds(this._indicator?.menu?.box),
            this._actorBounds(this._indicator)
        );
    }

    _actorBounds(actor) {
        if (!actor || !actor.visible)
            return null;

        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();

        return {x, y, width, height};
    }

    _combineBounds(...boundsList) {
        const bounds = boundsList.filter(Boolean);

        if (!bounds.length)
            return null;

        const left = Math.min(...bounds.map(boundsItem => boundsItem.x));
        const top = Math.min(...bounds.map(boundsItem => boundsItem.y));
        const right = Math.max(...bounds.map(boundsItem => boundsItem.x + boundsItem.width));
        const bottom = Math.max(...bounds.map(boundsItem => boundsItem.y + boundsItem.height));

        return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        };
    }

    _isPointerInBounds(bounds) {
        if (!bounds)
            return false;

        const [pointerX, pointerY] = global.get_pointer();

        return pointerX >= bounds.x &&
            pointerX <= bounds.x + bounds.width &&
            pointerY >= bounds.y &&
            pointerY <= bounds.y + bounds.height;
    }

    _isPointerOverActor(actor) {
        if (!actor || !actor.visible)
            return false;

        const [pointerX, pointerY] = global.get_pointer();
        const [actorX, actorY] = actor.get_transformed_position();
        const [actorWidth, actorHeight] = actor.get_transformed_size();

        return pointerX >= actorX &&
            pointerX <= actorX + actorWidth &&
            pointerY >= actorY &&
            pointerY <= actorY + actorHeight;
    }

    _scheduleMenuReopen(menuBounds) {
        if (this._menuReopenIdleId)
            GLib.source_remove(this._menuReopenIdleId);

        this._menuReopenIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._menuReopenIdleId = 0;

            if (this._indicator &&
                (this._isPointerInBounds(menuBounds) || this._isPointerOverMenuWindow())) {
                this._cancelMenuClose();
                this._indicator.menu.open();
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleMenuClose() {
        this._cancelMenuClose();

        this._menuCloseTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            MENU_CLOSE_DELAY_MS,
            () => {
                this._menuCloseTimeoutId = 0;

                if (this._indicator &&
                    this._indicator.menu.isOpen &&
                    !this._isPointerOverMenuWindow()) {
                    this._indicator.menu.close();
                }

                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelMenuClose() {
        if (!this._menuCloseTimeoutId)
            return;

        GLib.source_remove(this._menuCloseTimeoutId);
        this._menuCloseTimeoutId = 0;
    }

    _clearMenuTimers() {
        if (this._menuCloseTimeoutId) {
            GLib.source_remove(this._menuCloseTimeoutId);
            this._menuCloseTimeoutId = 0;
        }

        if (this._menuReopenIdleId) {
            GLib.source_remove(this._menuReopenIdleId);
            this._menuReopenIdleId = 0;
        }
    }

    _buildMenu() {
        this._addDrawingActionItem();
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._addToolItem('Trazo libre', Tool.FREE);
        this._addToolItem('Rectángulo', Tool.RECT);
        this._addToolItem('Elipse', Tool.ELLIPSE);
        this._addToolItem('Flecha', Tool.ARROW);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addColorItem('Verde', INK_COLORS.green);
        this._addColorItem('Rojo', INK_COLORS.red);
        this._addColorItem('Amarillo', INK_COLORS.yellow);
        this._addColorItem('Blanco', INK_COLORS.white);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const width of STROKE_WIDTH_PRESETS)
            this._addStrokeWidthItem(width);
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addActionItem('Deshacer', () => this._inkLayer.undo());
        this._addActionItem('Limpiar', () => this._inkLayer.clear());
    }

    _addDrawingActionItem() {
        this._drawingItem = new PopupMenu.PopupBaseMenuItem();
        const {row, label, iconBox} = this._createMenuRow(
            'Activar',
            this._createIcon('activate.svg', MENU_ICON_SIZE)
        );

        this._drawingLabel = label;
        this._drawingIconBox = iconBox;
        this._drawingItem.add_child(row);
        this._drawingItem.connect('activate', () => this._withMenuKeptOpen(
            () => this._toggleDrawing()
        ));
        this._syncDrawingItem();

        this._indicator.menu.addMenuItem(this._drawingItem);
    }

    _addColorItem(label, color) {
        const item = this._addActionItem(label, () => this._setInkColor(color), this._colorIconFor(label));
        this._colorItems.set(color, item);
        this._syncColorItems();
    }

    _addToolItem(label, tool) {
        const item = this._addActionItem(label, () => this._setTool(tool), this._toolIconFor(tool));
        this._toolItems.set(tool, item);
        this._syncToolItems();
    }

    _addStrokeWidthItem(width) {
        const item = new PopupMenu.PopupBaseMenuItem();
        const preview = this._createStrokeWidthPreview(width);
        const {row} = this._createMenuRow(
            `Grosor ${width} px`,
            preview
        );

        item.add_child(row);
        item.connect('activate', () => this._withMenuKeptOpen(
            () => this._setStrokeWidth(width)
        ));
        this._indicator.menu.addMenuItem(item);

        this._strokeWidthItems.set(width, item);
        this._strokeWidthPreviews.add(preview);
        this._syncStrokeWidthItems();
    }

    _addActionItem(label, callback, iconFileName = null) {
        const item = new PopupMenu.PopupBaseMenuItem();
        const {row} = this._createMenuRow(label, this._iconForLabel(label, iconFileName));

        item.add_child(row);
        item.connect('activate', () => this._withMenuKeptOpen(callback));
        this._indicator.menu.addMenuItem(item);

        return item;
    }

    _iconForLabel(label, iconFileName) {
        return this._createIcon(iconFileName ?? this._actionIconFor(label), MENU_ICON_SIZE);
    }

    _createStrokeWidthPreview(width) {
        const preview = new St.DrawingArea({
            width: MENU_ICON_SIZE,
            height: MENU_ICON_SIZE,
        });

        preview.connect('repaint', area => {
            const cr = area.get_context();

            try {
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.setSourceRGBA(...this._activeInkColor);
                cr.setLineWidth(width);
                cr.moveTo(6, MENU_ICON_SIZE / 2);
                cr.lineTo(MENU_ICON_SIZE - 6, MENU_ICON_SIZE / 2);
                cr.stroke();
            } finally {
                cr.$dispose();
            }
        });

        return preview;
    }

    _toolIconFor(tool) {
        switch (tool) {
        case Tool.FREE:
            return 'free.svg';
        case Tool.RECT:
            return 'rect.svg';
        case Tool.ARROW:
            return 'arrow.svg';
        case Tool.ELLIPSE:
        default:
            return 'ellipse.svg';
        }
    }

    _colorIconFor(label) {
        switch (label) {
        case 'Verde':
            return 'color-green.svg';
        case 'Rojo':
            return 'color-red.svg';
        case 'Amarillo':
            return 'color-yellow.svg';
        case 'Blanco':
        default:
            return 'color-white.svg';
        }
    }

    _actionIconFor(label) {
        switch (label) {
        case 'Deshacer':
            return 'undo.svg';
        case 'Limpiar':
            return 'clear.svg';
        default:
            return 'color-green.svg';
        }
    }

    _setTool(tool) {
        this._activeTool = tool;
        this._inkLayer.setTool(tool);
        this._syncToolItems();
    }

    _setInkColor(color) {
        this._activeInkColor = color;
        this._inkLayer.setInkColor(color);
        this._syncColorItems();
        this._syncStrokeWidthPreviews();
    }

    _setStrokeWidth(width) {
        this._activeStrokeWidth = width;
        this._inkLayer.setStrokeWidth(width);
        this._syncStrokeWidthItems();
    }

    _syncColorItems() {
        if (!this._colorItems)
            return;

        for (const [color, item] of this._colorItems) {
            const ornament = color === this._activeInkColor
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE;
            item.setOrnament(ornament);
        }
    }

    _syncToolItems() {
        if (!this._toolItems)
            return;

        for (const [tool, item] of this._toolItems) {
            const ornament = tool === this._activeTool
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE;
            item.setOrnament(ornament);
        }
    }

    _syncStrokeWidthItems() {
        if (!this._strokeWidthItems)
            return;

        for (const [width, item] of this._strokeWidthItems) {
            const ornament = width === this._activeStrokeWidth
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE;
            item.setOrnament(ornament);
        }
    }

    _syncStrokeWidthPreviews() {
        if (!this._strokeWidthPreviews)
            return;

        for (const preview of this._strokeWidthPreviews)
            preview.queue_repaint();
    }

    _toggleDrawing() {
        if (!this._inkLayer)
            return;

        this._drawingEnabled = !this._drawingEnabled;

        if (this._drawingEnabled) {
            this._inkLayer.startDrawing();
        } else {
            this._inkLayer.stopDrawing();
        }
        this._syncDrawingItem();
    }

    _syncDrawingItem() {
        if (!this._drawingLabel || !this._drawingIconBox)
            return;

        this._drawingLabel.text = this._drawingEnabled ? 'Desactivar' : 'Activar';
        this._drawingIconBox.set_child(this._createIcon(
            this._drawingEnabled ? 'deactivate.svg' : 'activate.svg',
            MENU_ICON_SIZE
        ));
    }
}
