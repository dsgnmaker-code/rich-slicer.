#target photoshop
/* Rich Slicer RU Preview 2.7.2 | Photoshop ExtendScript / ScriptUI | UTF-8 BOM file */
(function () {
    if (app.documents.length === 0) { alert('Сначала открой изображение в Photoshop.'); return; }
    var original = app.activeDocument;
    var W = Math.round(original.width.as('px'));
    var H = Math.round(original.height.as('px'));
    var oldUnits = app.preferences.rulerUnits;
    var thumbnail = null;
    var previewError = '';
    var tempFiles = [], previewSerial = 0;
    var draggingOzon = null;
    var sourceFolder = null, ozSeparateRoot = null, singleParent = null;
    try { sourceFolder = original.path; } catch (_) { sourceFolder = null; }
    ozSeparateRoot = new Folder((sourceFolder || Folder.myDocuments).fsName + '/OZON');
    singleParent = sourceFolder ? new Folder(sourceFolder.fsName + "/SEGMENTS") : null;
    function folderPath(f) { return f ? f.fsName : 'Не выбрана'; }
    function validFolderName(name) {
        // Check characters one by one: this avoids a regex parsing issue
        // in Adobe ExtendScript used by Photoshop 2023.
        if (!name || name.length === 0 || name === '.' || name === '..') return false;
        if (name.charAt(name.length - 1) === '.' || name.charAt(name.length - 1) === ' ') return false;
        var forbidden = '<>:"/\\|?*';
        for (var i = 0; i < name.length; i++) {
            var ch = name.charAt(i);
            if (name.charCodeAt(i) < 32 || forbidden.indexOf(ch) !== -1) return false;
        }
        return true;
    }
    function childFolder(parent, name) {
        if (!parent) throw new Error('Не выбрана корневая папка сохранения.');
        if (!validFolderName(name)) throw new Error('Недопустимое имя папки: ' + name);
        return new Folder(parent.fsName + '/' + name);
    }
    function ensureFolder(folder) {
        if (folder.exists) return;
        // Photoshop ExtendScript requires parent folders to exist before create().
        if (folder.parent && !folder.parent.exists) ensureFolder(folder.parent);
        if (!folder.create() && !folder.exists)
            throw new Error('Не удалось создать папку: ' + folder.fsName);
    }
    function resolvedOZRoot() {
        if (oneFolder.value) {
            if (!singleParent) throw new Error('Выбери общую корневую папку сохранения.');
            return childFolder(singleParent, 'OZON');
        }
        return ozSeparateRoot;
    }
    var checks = [], slotLabels = [], rectangles = [];
    // Desktop and Mobile are independent jobs, each resized from the ORIGINAL.
    var OZ_DESKTOP_WIDTH = 1200, OZ_MOBILE_WIDTH = 640;
    var OZ_DESKTOP_LIMIT = 3000, OZ_MOBILE_LIMIT = 1400;
    var ozonPanels = [];
    // Compact layout also works on 768/900px-tall laptop displays.
    var availableH = 800;
    try {
        if (typeof $ !== 'undefined' && $.screens && $.screens.length) {
            var scr = $.screens[0];
            if (scr.bottom - scr.top > 0) availableH = scr.bottom - scr.top - 70;
        }
    } catch (_) {}
    var SMALL_SCREEN = availableH < 790;
    var PREVIEW_W = SMALL_SCREEN ? 236 : 254;
    var PREVIEW_H = SMALL_SCREEN ? 145 : 190;
    var WB_W = 155, WB_H = SMALL_SCREEN ? 210 : 240;
    var BLUE = [0.12,0.48,1,1], BLUE_FILL = [0.10,0.43,1,0.26];
    var WHITE = [1,1,1,1], GRAY = [0.5,0.5,0.5,0.8], BLACK = [0.08,0.08,0.08,1];
    function shortenPath(path, length) {
        path=String(path || '');
        if (path.length <= length) return path;
        return '…'+path.substr(path.length-length+1);
    }

    function parseIntSafe(text, fallback) {
        var value = Number(text);
        return isFinite(value) && value >= 0 && Math.floor(value) === value ? value : fallback;
    }
    function positive(text, fallback) { var v = parseIntSafe(text, fallback); return v > 0 ? v : fallback; }
    function clamp(v, low, high) { return Math.max(low, Math.min(high, v)); }
    function pad(n) { var v=String(n); while(v.length<2) v='0'+v; return v; }
    function safeClose(doc) { try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {} }
    function makeCopy(name) { app.activeDocument = original; return original.duplicate(name, false); }
    function resizeWidth(doc, width) {
        if (Math.round(doc.width.as('px')) !== width)
            doc.resizeImage(UnitValue(width,'px'), null, null, ResampleMethod.BICUBICSHARPER);
    }
    function saveJpeg(doc, file, quality) {
        var opts = new JPEGSaveOptions(); opts.quality = quality;
        opts.embedColorProfile = true; opts.formatOptions = FormatOptions.STANDARDBASELINE;
        doc.saveAs(file, opts, true, Extension.LOWERCASE);
    }
    function temporaryImageFile(extension) {
        previewSerial++;
        var path = Folder.temp.fsName + '/rich_slicer_v27_' + (new Date()).getTime() + '_'
            + previewSerial + '_' + Math.floor(Math.random() * 100000) + '.' + extension;
        var file = new File(path);
        tempFiles.push(file);
        return file;
    }
    function makePreviewRGB(doc) {
        // The preview is a duplicate. Source document mode and bits never change.
        try { doc.flatten(); } catch (_) {}
        if (doc.mode !== DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
        if (doc.bitsPerChannel !== BitsPerChannelType.EIGHT)
            doc.bitsPerChannel = BitsPerChannelType.EIGHT;
    }
    function previewImageFromDoc(doc) {
        makePreviewRGB(doc);
        var w = Math.max(1, Math.round(doc.width.as('px')));
        var h = Math.max(1, Math.round(doc.height.as('px')));
        var scale = Math.min(1, 420/w, 750/h);
        if (scale < 1) resizeWidth(doc, Math.max(1,Math.round(w*scale)));
        var file = temporaryImageFile('png');
        try {
            var png = new PNGSaveOptions(); png.interlaced = false;
            doc.saveAs(file,png,true,Extension.LOWERCASE);
            if (!file.exists || file.length < 20) throw new Error('PNG file missing');
            var result = ScriptUI.newImage(file.fsName);
            if (!result || (result.size && result.size.width === 0)) throw new Error('ScriptUI cannot read PNG');
            return result;
        } catch (pngErr) {
            // JPEG fallback for Photoshop configurations where PNG saving fails.
            var jpg = temporaryImageFile('jpg');
            var opts = new JPEGSaveOptions(); opts.quality = 7;
            opts.embedColorProfile = true; opts.formatOptions=FormatOptions.STANDARDBASELINE;
            doc.saveAs(jpg,opts,true,Extension.LOWERCASE);
            if (!jpg.exists || jpg.length < 20) throw new Error('JPEG preview missing: ' + pngErr.message);
            var image = ScriptUI.newImage(jpg.fsName);
            if (!image || (image.size && image.size.width === 0)) throw new Error('ScriptUI cannot read JPEG: ' + pngErr.message);
            return image;
        }
    }
    function makeThumbnail() {
        var doc = null; previewError = ''; thumbnail = null;
        try {
            doc = makeCopy('Rich Slicer: source preview');
            thumbnail = previewImageFromDoc(doc);
        } catch (e) { previewError = e.message || String(e); }
        finally { safeClose(doc); try { app.activeDocument=original; } catch (_) {} }
    }
    function previewImageFromCrop(width, top, cropHeight) {
        var doc = null;
        try {
            doc = makeCopy('Rich Slicer: cropped preview ' + width);
            resizeWidth(doc, width);
            var total = Math.max(1, Math.round(doc.height.as('px')));
            var safeHeight = clamp(Math.round(cropHeight), 1, total);
            var maxTop = Math.max(0, total - safeHeight);
            var safeTop = clamp(Math.round(top), 0, maxTop);
            doc.crop([UnitValue(0,'px'),UnitValue(safeTop,'px'),UnitValue(width,'px'),UnitValue(safeTop + safeHeight,'px')]);
            // Keep the crop dimensions in desktop/mobile pixels BEFORE
            // previewImageFromDoc() scales the temporary document for ScriptUI.
            var sourceCropHeight = Math.round(doc.height.as('px'));
            var image = previewImageFromDoc(doc);
            // Intrinsic ScriptUIImage dimensions are for correct aspect-ratio painting;
            // cropHeight is for translating pointer coordinates into source pixels.
            var imgW = Math.round(doc.width.as('px'));
            var imgH = Math.round(doc.height.as('px'));
            return { image:image, imageW:imgW, imageH:imgH,
                cropHeight:sourceCropHeight, top:safeTop, total:total };
        } finally { safeClose(doc); try { app.activeDocument=original; } catch (_) {} }
    }
    function buildZoomMeta(state) {
        var total = scaledHeight(state.width);
        var cut = state.plan ? state.plan.first : Math.min(state.limit, total);
        var targetCrop = Math.max(120, Math.round(state.width * PREVIEW_H / PREVIEW_W));
        var cropHeight = Math.min(total, targetCrop);
        var cropTop = Math.round(cut - cropHeight / 2);
        if (cropTop < 0) cropTop = 0;
        if (cropTop + cropHeight > total) cropTop = total - cropHeight;
        if (cropTop < 0) cropTop = 0;
        return { top:cropTop, height:cropHeight, cut:cut, total:total };
    }
    function refreshOzonPreview(state) {
        // IMPORTANT: Expensive Photoshop calls are only allowed after a gesture
        // finishes (mouse up, slider onChange, text onChange or explicit refresh).
        // Never call this function from onChanging/mousemove/onDraw.
        if (!state || !state.plan || state.previewBusy) return;
        state.previewBusy = true;
        var info = null;
        try {
            var meta = buildZoomMeta(state);
            info = previewImageFromCrop(state.width, meta.top, meta.height);
            state.previewImage = info.image;
            state.previewMeta = { top:info.top, height:info.cropHeight,
                cut:meta.cut, total:info.total,
                imageW:info.imageW, imageH:info.imageH };
            try { state.canvas.image = state.previewImage || undefined; } catch (_) {}
        } catch (e) {
            // Retain the last good photo if a one-off preview refresh fails.
            previewError = e.message || String(e);
        } finally {
            state.previewBusy = false;
        }
    }
    function scaledHeight(width) { return Math.max(1, Math.round(H * width / W)); }
    function paintRect(g, x,y,w,h,rgba) {
        if (w < 1 || h < 1) return;
        g.newPath(); g.rectPath(x,y,w,h);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, rgba));
    }
    function frame(g, x,y,w,h,rgba,weight) {
        g.newPath(); g.rectPath(x,y,w,h);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR,rgba,weight || 2));
    }
    // Get the ACTUAL visible image bounds. Never force a tall source into a wide rectangle.
    // These bounds are used for BOTH painting and mouse coordinate conversion.
    function previewBox(w,h) {
        var margin=4;
        var factor=Math.min((w-2*margin)/W,(h-2*margin)/H);
        var imageW=Math.max(1,Math.round(W*factor));
        var imageH=Math.max(1,Math.round(H*factor));
        return {x:Math.round((w-imageW)/2),y:Math.round((h-imageH)/2),w:imageW,h:imageH};
    }
    function previewBoxForDims(w,h,imgW,imgH) {
        var margin=4;
        imgW=Math.max(1,Math.round(imgW)); imgH=Math.max(1,Math.round(imgH));
        var factor=Math.min((w-2*margin)/imgW,(h-2*margin)/imgH);
        var imageW=Math.max(1,Math.round(imgW*factor));
        var imageH=Math.max(1,Math.round(imgH*factor));
        return {x:Math.round((w-imageW)/2),y:Math.round((h-imageH)/2),w:imageW,h:imageH};
    }
    function paintPreview(g,w,h,image) {
        paintRect(g,0,0,w,h,[0.18,0.18,0.19,1]);
        var p=previewBox(w,h);
        if (image) g.drawImage(image,p.x,p.y,p.w,p.h);
        else paintRect(g,p.x,p.y,p.w,p.h,[0.34,0.34,0.35,1]);
        frame(g,p.x,p.y,p.w,p.h,image?GRAY:WHITE,1);
        return p;
    }
    function refreshCanvas(ctrl) {
        if (!ctrl) return;
        // Notify the ACTUAL image control; window.update() alone leaves old pixels.
        try { if (ctrl.notify) ctrl.notify('onDraw'); } catch (_) {}
        try { if (ctrl.window && ctrl.window.visible) ctrl.window.update(); } catch (_) {}
    }
    function makeCanvas(parent,width,height,image) {
        var view=parent.add('image',undefined,image || undefined);
        view.preferredSize=[width,height]; view.minimumSize=[width,height];
        view.maximumSize=[width,height];
        return view;
    }
    // Split an exact integer pixel height without gaps, overlaps, or too-tall pieces.
    // Auto: all slices as evenly sized as possible (difference <= 1 px).
    // Manual: first slice is user-set, REMAINDER is evenly split into <=limit px pieces.
    function planOzonCuts(total, limit, manualFirst) {
        total=Math.round(total);limit=Math.round(limit);
        if (!(total>0) || !(limit>0)) throw new Error('OZON: недопустимая высота изображения.');
        var borders=[0], i, n, first, rest;
        if (manualFirst === null || typeof manualFirst === 'undefined') {
            n=Math.ceil(total/limit);
            for (i=1;i<=n;i++) borders.push(Math.round(i*total/n));
        } else {
            first=clamp(Math.round(manualFirst),1,Math.min(total,limit));
            borders.push(first);
            rest=total-first;
            if (rest>0) {
                n=Math.ceil(rest/limit);
                for(i=1;i<=n;i++) borders.push(first+Math.round(i*rest/n));
            }
        }
        var slices=[];
        for(i=1;i<borders.length;i++) {
            var from=borders[i-1],to=borders[i];
            if (from>=to || to-from>limit || (i===borders.length-1 && to!==total))
                throw new Error('OZON: нарушены границы сегментов.');
            slices.push({start:from,end:to,height:to-from,index:i});
        }
        return {total:total,limit:limit,first:slices[0].height,slices:slices,
            manual:!(manualFirst===null || typeof manualFirst==='undefined')};
    }
    function allSettings() {
        return {
            quality: parseIntSafe(quality.text,12),
            wbHeight:positive(wbHeight.text,900), wbWidth:wbResize.value ? 1440 : W,
            ozon:[
                {width:OZ_DESKTOP_WIDTH,limit:OZ_DESKTOP_LIMIT,first:ozonPanels[0].manualFirst},
                {width:OZ_MOBILE_WIDTH,limit:OZ_MOBILE_LIMIT,first:ozonPanels[1].manualFirst}
            ]
        };
    }

    makeThumbnail();
    var win = new Window('dialog','Rich Slicer 2.7.2 — Wildberries и OZON');
    win.orientation='column'; win.alignChildren=['fill','top']; win.margins=8; win.spacing=5;
    var topLine=win.add('group');topLine.orientation='row';topLine.alignChildren=['left','center'];topLine.spacing=16;
    topLine.add('statictext',undefined,'Исходник: '+W+' × '+H+' px');
    var sourcePreviewStatus=topLine.add('statictext',undefined,thumbnail?'Фото загружено':'Ошибка фото-превью');
    sourcePreviewStatus.preferredSize=[180,18];
    sourcePreviewStatus.helpTip=previewError;
    var common=win.add('group'); common.orientation='row'; common.alignChildren=['left','center'];
    common.add('statictext',undefined,'Качество JPEG (1–12):');
    var quality=common.add('edittext',undefined,'12'); quality.characters=4;
    var destinationPanel=win.add('panel',undefined,'Сохранение');
    destinationPanel.orientation='column'; destinationPanel.alignChildren=['fill','top'];
    destinationPanel.margins=7;destinationPanel.spacing=2;
    var oneFolder=destinationPanel.add('checkbox',undefined,'Все файлы в одну папку (по умолчанию)'); oneFolder.value=true;
    var sharedRow=destinationPanel.add('group'); sharedRow.orientation='row';sharedRow.alignChildren=['left','center'];
    var sharedFolderText=sharedRow.add('statictext',undefined,''); sharedFolderText.preferredSize=[420,18];
    var chooseShared=sharedRow.add('button',undefined,'Выбрать папку...');
    var overwrite=destinationPanel.add('checkbox',undefined,'Перезаписывать существующие JPEG (без дополнительного вопроса)');
    overwrite.value=false;
    var wbFolderDisplay=destinationPanel.add('statictext',undefined,'');
    wbFolderDisplay.preferredSize=[620,18];
    function refreshFolderSettings() {
        sharedRow.enabled=oneFolder.value;
        var full=singleParent?folderPath(singleParent):'выбери папку (файл ещё не сохранён)';
        sharedFolderText.text='Папка: '+shortenPath(full,60);
        sharedFolderText.helpTip=full;
        if (oneFolder.value) wbFolderDisplay.text='WB: Rich_XX.jpg   |   OZON: OZON/1200 и OZON/640';
        else wbFolderDisplay.text='WB: '+shortenPath(sourceFolder?sourceFolder.fsName+'/SEGMENTS':'сначала сохрани исходник',68);
        wbFolderDisplay.helpTip=sourceFolder?sourceFolder.fsName+'/SEGMENTS':'';
    }
    chooseShared.onClick=function(){
        var folder=Folder.selectDialog('Выбери общую папку для WB и OZON');
        if (folder) { singleParent=folder;refreshFolderSettings(); }
    };
    oneFolder.onClick=function(){refreshFolderSettings(); if (typeof d!=='undefined' && d) updateSeparateFolders();};
    refreshFolderSettings();
    var tabs=win.add('tabbedpanel'); tabs.preferredSize=[650,SMALL_SCREEN?370:410];

    // Wildberries section
    var wbTab=tabs.add('tab',undefined,'Wildberries'); wbTab.orientation='column'; wbTab.alignChildren=['fill','top']; wbTab.margins=7;
    var wbControls=wbTab.add('group'); wbControls.orientation='row';
    wbControls.add('statictext',undefined,'Высота сегмента:');
    var wbHeight=wbControls.add('edittext',undefined,'900'); wbHeight.characters=7;
    wbControls.add('statictext',undefined,'px');
    var wbResize=wbControls.add('checkbox',undefined,'Привести ширину к 1440 px'); wbResize.value=true;
    var wbStatus=wbTab.add('statictext',undefined,''); wbStatus.preferredSize=[610,18];
    var wbBody=wbTab.add('group'); wbBody.orientation='row'; wbBody.alignChildren=['left','top']; wbBody.spacing=14;
    var wbCanvasGroup=wbBody.add('panel',undefined,'Миниатюра и разрезы'); wbCanvasGroup.orientation='column'; wbCanvasGroup.alignChildren='center';
    var wbCanvas=makeCanvas(wbCanvasGroup,WB_W,WB_H,thumbnail);
    wbCanvas.helpTip='Нажми на синюю часть, чтобы включить или выключить её экспорт';
    var wbSlots=wbBody.add('panel',undefined,'10 возможных частей'); wbSlots.orientation='column'; wbSlots.alignChildren=['left','top']; wbSlots.spacing=3;
    for (var j=0;j<10;j++) {
        var row=wbSlots.add('group'); row.orientation='row';
        checks[j]=row.add('checkbox',undefined,''); checks[j].value=true;
        slotLabels[j]=row.add('statictext',undefined,''); slotLabels[j].characters=29;
        (function(index) { checks[index].onClick=function(){refreshCanvas(wbCanvas);}; })(j);
    }
    var wbHint=wbTab.add('statictext',undefined,'Синим отмечены выбранные части. Нажимай на миниатюру или галочки.');
    function updateWB() {
        var segmentHeight=positive(wbHeight.text,900), width=wbResize.value?1440:W;
        var totalHeight=scaledHeight(width), count=Math.ceil(totalHeight/segmentHeight);
        wbStatus.text='После изменения ширины: '+width+' × '+totalHeight+' px     |     Сегментов: '+count+' / 10'+(count>10?' — ПРЕВЫШЕН ЛИМИТ':'');
        rectangles=[];
        for (var i=0;i<10;i++) {
            var active=i<count;
            checks[i].enabled=active;
            if (!active) checks[i].value=false;
            var from=i*segmentHeight, to=Math.min((i+1)*segmentHeight,totalHeight);
            slotLabels[i].text=active?'№ '+pad(i+1)+'    '+from+'–'+to+' px':'№ '+pad(i+1)+'    нет в исходнике';
            if (active) rectangles.push({start:from,end:to,index:i});
        }
        refreshCanvas(wbCanvas);
    }
    wbCanvas.onDraw=function() {
        var g=this.graphics, full=scaledHeight(wbResize.value?1440:W);
        var p=paintPreview(g,WB_W,WB_H,thumbnail);
        for (var i=0;i<rectangles.length;i++) {
            var r=rectangles[i];
            var y=p.y+Math.floor(p.h*r.start/full);
            var y2=p.y+Math.ceil(p.h*r.end/full);
            var ht=Math.max(1,y2-y);
            if (checks[r.index].value) paintRect(g,p.x,y,p.w,ht,BLUE_FILL);
            frame(g,p.x,y,p.w,ht,checks[r.index].value?BLUE:GRAY,checks[r.index].value?2:1);
        }
    };
    wbCanvas.addEventListener('mousedown',function(e){
        var p=previewBox(WB_W,WB_H),x=eventX(e),y=eventY(e);
        if (x<p.x || x>p.x+p.w || y<p.y || y>p.y+p.h) return;
        var width=wbResize.value?1440:W;
        var pos=clamp((y-p.y)/p.h,0,0.999999)*scaledHeight(width);
        var index=Math.floor(pos/positive(wbHeight.text,900));
        if (index>=0&&index<10&&checks[index].enabled) {
            checks[index].value=!checks[index].value;refreshCanvas(wbCanvas);
        }
    });
    wbHeight.onChange=updateWB; wbResize.onClick=updateWB;

    // OZON: two INDEPENDENT crops from the original, one at 1200, one at 640.
    // Each first cut can be dragged; the remaining height is evenly distributed.
    var ozTab=tabs.add('tab',undefined,'OZON');
    ozTab.orientation='column';ozTab.alignChildren=['fill','top'];ozTab.margins=7;ozTab.spacing=4;
    var ozHint=ozTab.add('statictext',undefined,'Desktop и Mobile — отдельно. В превью показан увеличенный фрагмент вокруг первой линии разреза.');
    ozHint.preferredSize=[620,18];
    var ozBody=ozTab.add('group');ozBody.orientation='row';
    ozBody.alignChildren=['left','top'];ozBody.spacing=8;
    function addOzonPanel(parent, title, width, limit) {
        var state={width:width,limit:limit,manualFirst:null,plan:null,previewImage:null,previewMeta:null,
            setting:false,previewBusy:false};
        var panel=parent.add('panel',undefined,title+' — '+width+' px');
        panel.orientation='column';panel.alignChildren=['center','top'];
        panel.margins=7;panel.spacing=3;
        var controls=panel.add('group');controls.orientation='row';controls.alignChildren=['left','center'];controls.spacing=5;
        controls.add('statictext',undefined,'Первая часть:');
        state.field=controls.add('edittext',undefined,'');state.field.characters=5;
        state.auto=controls.add('button',undefined,'Авто');
        state.slider=panel.add('slider',undefined,1,1,limit);
        state.slider.preferredSize=[PREVIEW_W-4,18];
        state.status=panel.add('statictext',undefined,'');state.status.preferredSize=[PREVIEW_W,18];
        state.details=panel.add('statictext',undefined,'');state.details.preferredSize=[PREVIEW_W,18];
        state.canvas=makeCanvas(panel,PREVIEW_W,PREVIEW_H,thumbnail);
        state.canvas.helpTip='Увеличенный фрагмент вокруг первой линии разреза. Тяни синюю границу или используй ползунок.';
        state.auto.onClick=function(){setOzonFirst(state,null,true);};
        state.field.onChange=function(){
            if (state.setting) return;
            var v=Number(state.field.text);
            if (!isFinite(v) || v<1) v=state.plan.first;
            setOzonFirst(state,v,true);
        };
        // Live movement only changes numbers and the blue line. No Photoshop I/O.
        state.slider.onChanging=function(){if (!state.setting) setOzonFirst(state,this.value,false);};
        // Rebuild the photo exactly ONCE after releasing the slider.
        state.slider.onChange=function(){if (!state.setting) setOzonFirst(state,this.value,true);};
        state.canvas.onDraw=function(){drawOzonCuts(this.graphics,state);};
        state.canvas.addEventListener('mousedown',function(e){
            if (typeof e.button==='number' && e.button!==0) return;
            draggingOzon=state;
            setOzonFirst(state,ozonYToFirst(state,eventY(e)),false);
        });
        state.canvas.addEventListener('mousemove',function(e){
            if (draggingOzon===state) setOzonFirst(state,ozonYToFirst(state,eventY(e)),false);
        });
        state.canvas.addEventListener('mouseup',function(e){
            if (draggingOzon===state) {
                draggingOzon=null;
                setOzonFirst(state,ozonYToFirst(state,eventY(e)),true);
            }
        });
        state.canvas.addEventListener('mouseout',function(){
            // Recenter the photo once when a drag ends outside the preview.
            if (draggingOzon===state) {
                draggingOzon=null;
                refreshOzonPreview(state);
                refreshCanvas(state.canvas);
            }
        });
        ozonPanels.push(state);
        return state;
    }
    var d=addOzonPanel(ozBody,'DESKTOP',OZ_DESKTOP_WIDTH,OZ_DESKTOP_LIMIT);
    var m=addOzonPanel(ozBody,'MOBILE',OZ_MOBILE_WIDTH,OZ_MOBILE_LIMIT);
    win.addEventListener('mouseup',function(){
        if (draggingOzon) {
            var state=draggingOzon;
            draggingOzon=null;
            refreshOzonPreview(state);
            refreshCanvas(state.canvas);
        }
    });
    function ozonYToFirst(state,y) {
        var meta = state.previewMeta;
        if (!meta) return state.plan ? state.plan.first : 1;
        var p=previewBoxForDims(PREVIEW_W,PREVIEW_H,meta.imageW,meta.imageH);
        var local=Math.round((clamp(y,p.y,p.y+p.h)-p.y) * meta.height / p.h);
        var height=meta.top + local;
        return clamp(height,1,Math.min(state.limit,state.plan.total));
    }
    function setOzonFirst(state,firstOrNull,commitPreview) {
        // Avoid ScriptUI reentry: programmatic changes of slider.value may fire
        // onChanging on certain Photoshop versions.
        if (state.setting) return;
        if (firstOrNull===null || typeof firstOrNull==='undefined') state.manualFirst=null;
        else state.manualFirst=clamp(Math.round(firstOrNull),1,Math.min(state.limit,scaledHeight(state.width)));
        updateOzonPanel(state,commitPreview === true);
    }
    function updateOzonPanel(state,commitPreview) {
        if (state.setting) return;
        state.setting=true;
        try {
            var predictedTotal=scaledHeight(state.width);
            state.plan=planOzonCuts(predictedTotal,state.limit,state.manualFirst);
            var plan=state.plan;
            state.field.text=String(plan.first);
            state.slider.minvalue=1;
            state.slider.maxvalue=Math.min(state.limit,predictedTotal);
            if (Math.round(state.slider.value)!==plan.first) state.slider.value=plan.first;
            state.status.text='Высота '+predictedTotal+' px  |  файлов: '+plan.slices.length;
            state.details.text=(plan.manual?'Ручная':'Авто, поровну')+'  |  лимит: '+state.limit+' px';
            state.canvas.helpTip='Увеличенный фрагмент вокруг первой линии. Лимит '+state.limit+' px; '
                +plan.slices.length+' фрагм. Первая граница: '+plan.first+' px.';
        } finally { state.setting=false; }
        // Paint and UI updates are harmless; Photoshop duplications are deferred.
        if (commitPreview === true) refreshOzonPreview(state);
        refreshCanvas(state.canvas);
    }
    function drawOzonCuts(g,state) {
        var meta = state.previewMeta;
        paintRect(g,0,0,PREVIEW_W,PREVIEW_H,[0.18,0.18,0.19,1]);
        var p = meta ? previewBoxForDims(PREVIEW_W,PREVIEW_H,meta.imageW,meta.imageH) : previewBox(PREVIEW_W,PREVIEW_H);
        if (state.previewImage) g.drawImage(state.previewImage,p.x,p.y,p.w,p.h);
        else if (thumbnail) g.drawImage(thumbnail,p.x,p.y,p.w,p.h);
        else paintRect(g,p.x,p.y,p.w,p.h,[0.34,0.34,0.35,1]);
        frame(g,p.x,p.y,p.w,p.h,state.previewImage?GRAY:WHITE,1);
        if (!state.plan || !meta) return;
        var firstY=p.y+Math.round(p.h*(state.plan.first-meta.top)/meta.height);
        var safeY=clamp(firstY,p.y,p.y+p.h-1);
        var shadeTop=Math.max(0,safeY-p.y);
        var shadeBottom=Math.max(0,(p.y+p.h)-safeY);
        if (shadeTop>0) paintRect(g,p.x,p.y,p.w,shadeTop,[0.10,0.43,1,0.08]);
        if (shadeBottom>0) paintRect(g,p.x,safeY,p.w,shadeBottom,[0.10,0.43,1,0.08]);
        paintRect(g,p.x,clamp(safeY-2,p.y,p.y+p.h-4),p.w,4,BLUE);
    }
    var ozStorage=ozTab.add('panel',undefined,'Папки OZON');
    ozStorage.orientation='column';ozStorage.alignChildren=['fill','top'];ozStorage.margins=5;ozStorage.spacing=2;
    var ozFolderLine=ozStorage.add('group');ozFolderLine.orientation='row';
    ozFolderLine.alignChildren=['left','center'];ozFolderLine.spacing=7;
    var ozFolderInfo=ozFolderLine.add('statictext',undefined,'');ozFolderInfo.preferredSize=[425,18];
    var ozSelect=ozFolderLine.add('button',undefined,'Выбрать папку...');
    // Full paths and output subfolders are shown in a tooltip to keep the dialog compact.

    function updateSeparateFolders() {
        ozSelect.enabled=!oneFolder.value;
        var folder;
        try { folder=resolvedOZRoot(); }
        catch(e) {folder=null;}
        ozFolderInfo.text='Корень: '+shortenPath(folderPath(folder),55);
        ozFolderInfo.helpTip=folderPath(folder)+'\n1200/OZON_01.jpg…\n640/OZON_01.jpg…';
    }
    ozSelect.onClick=function(){
        var p=Folder.selectDialog('Выбери КОРНЕВУЮ папку OZON (внутри создадим 1200 и 640)');
        if (p) {ozSeparateRoot=p;updateSeparateFolders();}
    };
    updateSeparateFolders();
    // Shared root folder selector also changes the two OZON subfolders.
    var formerSharedClick=chooseShared.onClick;
    chooseShared.onClick=function(){formerSharedClick();updateSeparateFolders();};
    function updatePreviewMessage() {
        sourcePreviewStatus.text=previewError?'Ошибка фото-превью':'Фото загружено';
        sourcePreviewStatus.helpTip=previewError;
    }
    var refreshBtn=ozStorage.add('button',undefined,'Обновить фото-превью');
    refreshBtn.alignment='left';
    refreshBtn.onClick=function(){
        makeThumbnail();
        try { wbCanvas.image=thumbnail || undefined; } catch (_) {}
        for (var i=0;i<ozonPanels.length;i++) {
            refreshOzonPreview(ozonPanels[i]);
            refreshCanvas(ozonPanels[i].canvas);
        }
        updatePreviewMessage();refreshCanvas(wbCanvas);
    };
    function eventX(e) {
        if (e && typeof e.clientX==='number') return e.clientX;
        if (e && typeof e.x==='number') return e.x;
        return -1;
    }
    function eventY(e) {
        if (e && typeof e.clientY==='number') return e.clientY;
        if (e && typeof e.y==='number') return e.y;
        return 2;
    }

    // Export progress and result appear INSIDE the existing dialog.
    // Never display a nested alert over a disabled ScriptUI dialog: Photoshop can
    // return focus to its document, leaving the script dialog unusable until Alt+Tab.
    var exportResult=win.add('panel',undefined,'Результат экспорта');
    exportResult.orientation='column';exportResult.alignChildren=['fill','top'];
    exportResult.margins=5;exportResult.spacing=2;
    var exportTitle=exportResult.add('statictext',undefined,'Готов к сохранению.');
    var exportDetails=exportResult.add('edittext',undefined,
        'После сохранения здесь появятся количество файлов и папки.',
        {multiline:true,readonly:true,scrolling:true});
    exportDetails.preferredSize=[620,28];

    // Buttons stay in the same modal window; only buttons, not the WINDOW,
    // are disabled during Photoshop operations.
    var bottom=win.add('group');bottom.orientation='row';bottom.alignment='center';
    var exportWB=bottom.add('button',undefined,'Сохранить WB');
    var exportOZ=bottom.add('button',undefined,'Сохранить OZON');
    var exportBoth=bottom.add('button',undefined,'Сохранить всё');
    var close=bottom.add('button',undefined,'Закрыть');
    close.onClick=function(){win.close();};
    win.cancelElement=close;
    var isExporting=false;
    function lockExportButtons(locked) {
        exportWB.enabled=!locked;
        exportOZ.enabled=!locked;
        exportBoth.enabled=!locked;
        close.enabled=!locked;
    }
    function writeExportResult(title,details) {
        exportTitle.text=title;
        exportDetails.text=details || '';
    }
    function restoreWindowFocus() {
        // Photoshop document activation can steal focus from ScriptUI.
        // Do this only AFTER all temp docs are closed and original is active.
        try { if (win.visible) win.update(); } catch (_) {}
        try { win.active=true; } catch (_) {}
        try { close.active=true; } catch (_) {}
    }
    function replaceSave(doc,file,quality) {
        if (file.exists) {
            if (!overwrite.value) throw new Error('Файл уже существует: '+file.fsName);
            if (!file.remove()) throw new Error('Не удалось перезаписать файл: '+file.fsName);
        }
        saveJpeg(doc,file,quality);
    }
    function execute(wb,oz) {
        if (isExporting) return;
        isExporting=true;
        lockExportButtons(true);
        writeExportResult('Идёт сохранение...', 'Исходный файл не изменяется.');
        var s=null,tasks=[],existing=[],folders=[],results=[],ozBase=null;
        var unified=oneFolder.value;
        var commonDestination=unified ? singleParent : null;
        var resultTitle='',resultText='',saved=0,savedWB=0,savedD=0,savedM=0;
        try {
            s=allSettings();
            if (s.quality<1 || s.quality>12) throw new Error('Качество JPEG должно быть от 1 до 12.');
            if (unified && !commonDestination) throw new Error('Выбери общую папку сохранения либо сначала сохрани исходный файл.');
            if (wb) {
                if (!unified && !sourceFolder) throw new Error('Для сохранения WB рядом с исходником сначала сохрани исходный файл через Файл → Сохранить.');
                var wbDestination=unified ? commonDestination : new Folder(sourceFolder.fsName+'/SEGMENTS');
                folders.push(wbDestination);
                var sh=scaledHeight(s.wbWidth),count=Math.ceil(sh/s.wbHeight);
                if (count>10) throw new Error('WB: '+count+' частей. Допускается до 10. Увеличь высоту сегмента.');
                if (s.wbHeight>9000 || s.wbWidth>1440)
                    throw new Error('WB: максимальный размер части 1440 × 9000 px.');
                for (var i=0;i<count;i++) if (checks[i].value)
                    tasks.push({type:'wb',start:i*s.wbHeight,end:Math.min(sh,(i+1)*s.wbHeight),file:new File(wbDestination.fsName+'/Rich_'+pad(i+1)+'.jpg')});
            }
            if (oz) {
                var ozRoot=resolvedOZRoot();
                for (var oi=0;oi<s.ozon.length;oi++) {
                    var cfg=s.ozon[oi];
                    if (cfg.width<1 || cfg.limit<1 || cfg.limit>(cfg.width===1200?3000:1400))
                        throw new Error('OZON: превышен лимит размеров.');
                    var zoneFolder=childFolder(ozRoot,String(cfg.width));
                    folders.push(zoneFolder);
                    // Determine the REAL resized pixel height in Photoshop. Independently
                    // resize from the original for both Desktop and Mobile (no derivatives).
                    var measuringDoc=null,actualTotal=0;
                    try {
                        measuringDoc=makeCopy('Rich Slicer: measure OZON '+cfg.width);
                        resizeWidth(measuringDoc,cfg.width);
                        actualTotal=Math.round(measuringDoc.height.as('px'));
                    } finally { safeClose(measuringDoc); try{app.activeDocument=original;}catch (_){} }
                    var plan=planOzonCuts(actualTotal,cfg.limit,cfg.first);
                    for (var pi=0;pi<plan.slices.length;pi++) {
                        var slice=plan.slices[pi];
                        tasks.push({type:'ozone',width:cfg.width,total:actualTotal,
                            start:slice.start,end:slice.end,
                            file:new File(zoneFolder.fsName+'/OZON_'+pad(pi+1)+'.jpg')});
                    }
                }
            }
            if (!tasks.length) throw new Error('Не выбраны файлы для экспорта.');
            // Desktop and Mobile are independently numbered; counts may differ.
            var allOutputFiles=[];
            for (var q=0;q<tasks.length;q++) allOutputFiles.push(tasks[q].file);
            for (var a=0;a<allOutputFiles.length;a++) for (var b=a+1;b<allOutputFiles.length;b++)
                if (allOutputFiles[a].fsName.toLowerCase()===allOutputFiles[b].fsName.toLowerCase())
                    throw new Error('Два результата имеют одинаковое имя файла: '+allOutputFiles[a].fsName);
            // Check for existing outputs BEFORE creating folders or writing files.
            for (var k=0;k<allOutputFiles.length;k++) if (allOutputFiles[k].exists) existing.push(allOutputFiles[k].fsName);
            if (existing.length && !overwrite.value) throw new Error('Файлы уже существуют. Включи галочку «Перезаписывать существующие JPEG» или выбери другую папку:\n'+existing.join('\n'));
            for (var z=0;z<folders.length;z++) ensureFolder(folders[z]);
            app.preferences.rulerUnits=Units.PIXELS;
            var currentOzonWidth=0;
            for (var t=0;t<tasks.length;t++) {
                var task=tasks[t],doc=null;
                try {
                    if (task.type==='wb') {
                        doc=makeCopy('Rich Slicer: temporary WB export '+(t+1));
                        resizeWidth(doc,s.wbWidth);
                        var realHeight=Math.round(doc.height.as('px'));
                        var from=Math.min(task.start,realHeight-1);
                        var to=Math.min(task.end,realHeight);
                        if (to<=from) throw new Error('WB: empty segment after resize.');
                        doc.crop([UnitValue(0,'px'),UnitValue(from,'px'),
                            UnitValue(s.wbWidth,'px'),UnitValue(to,'px')]);
                        replaceSave(doc,task.file,s.quality); saved++;savedWB++;results.push(task.file.fsName);
                    } else {
                        if (currentOzonWidth!==task.width || !ozBase) {
                            safeClose(ozBase);ozBase=null;
                            ozBase=makeCopy('Rich Slicer: OZON source '+task.width+' px');
                            resizeWidth(ozBase,task.width);
                            currentOzonWidth=task.width;
                        }
                        if (Math.round(ozBase.height.as('px'))!==task.total)
                            throw new Error('OZON: размеры документа изменились между расчётом и экспортом.');
                        app.activeDocument=ozBase;
                        doc=ozBase.duplicate('OZON '+task.width+' № '+(t+1),false);
                        if (task.start<0 || task.end>task.total || task.end<=task.start ||
                            task.end-task.start>(task.width===1200?3000:1400))
                            throw new Error('OZON: неверные границы фрагмента.');
                        doc.crop([UnitValue(0,'px'),UnitValue(task.start,'px'),
                            UnitValue(task.width,'px'),UnitValue(task.end,'px')]);
                        if (Math.round(doc.height.as('px'))!==task.end-task.start)
                            throw new Error('OZON: высота кадра не совпала с расчётом.');
                        replaceSave(doc,task.file,s.quality);
                        saved++;if (task.width===OZ_DESKTOP_WIDTH) savedD++; else savedM++;
                        results.push(task.file.fsName);
                    }
                } finally { safeClose(doc); }
            }
            resultTitle='Готово! Сохранено JPEG: '+saved;
            var outputInfo=[];
            for (var fi=0;fi<folders.length;fi++) {
                var already=false;
                for (var fj=0;fj<fi;fj++) {
                    if (folders[fj].fsName===folders[fi].fsName) already=true;
                }
                if (!already) outputInfo.push(folders[fi].fsName);
            }
            resultText=(wb?'WB: '+savedWB+' JPEG\n':'')+
                (oz?'OZON Desktop (1200): '+savedD+' JPEG\nOZON Mobile (640): '+savedM+' JPEG\n':'')+
                'Папки сохранения:\n'+outputInfo.join('\n');
        } catch(e) {
            resultTitle='Ошибка сохранения';
            resultText=(e && e.message) ? e.message : String(e);
        } finally {
            // Never show alert() here: it steals activation from the open dialog.
            // Restore Photoshop state BEFORE reactivating the ScriptUI dialog.
            safeClose(ozBase);
            try { app.preferences.rulerUnits=oldUnits; } catch (_) {}
            try { app.activeDocument=original; } catch (_) {}
            isExporting=false;
            lockExportButtons(false);
            writeExportResult(resultTitle || 'Экспорт завершён',resultText);
            restoreWindowFocus();
        }
    }
    exportWB.onClick=function(){execute(true,false);};
    exportOZ.onClick=function(){execute(false,true);};
    exportBoth.onClick=function(){execute(true,true);};
    updateWB();updateOzonPanel(d,true);updateOzonPanel(m,true);updatePreviewMessage();tabs.selection=0;
    win.center();win.show();
    // Remove only temporary miniatures created by this script, after dialog closes.
    for (var z=0;z<tempFiles.length;z++) {
        try { if (tempFiles[z].exists) tempFiles[z].remove(); } catch (_) {}
    }
})();
