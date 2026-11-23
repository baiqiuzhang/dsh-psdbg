var docs = [];
for (var i = 0; i < app.documents.length; i++) {
  var d = app.documents[i];
  var item = {};
  try { item.name = d.name; } catch (e) { item.name = null; }
  try { item.saved = d.saved; } catch (e) { item.saved = null; }
  try { item.path = d.path ? d.path.fsName : null; } catch (e) { item.path = null; }
  try { item.width = d.width.as('px'); } catch (e) { item.width = null; }
  try { item.height = d.height.as('px'); } catch (e) { item.height = null; }
  try { item.mode = String(d.mode); } catch (e) { item.mode = null; }
  try { item.bitsPerChannel = String(d.bitsPerChannel); } catch (e) { item.bitsPerChannel = null; }
  docs.push(item);
}
var active = null;
try {
  var ad = app.activeDocument;
  active = { name: ad.name, saved: ad.saved, history: ad.activeHistoryState ? ad.activeHistoryState.name : null };
} catch (e) { active = null; }
return {
  version: app.version,
  name: app.name,
  documentCount: app.documents.length,
  documents: docs,
  activeDocument: active,
  displayDialogs: String(app.displayDialogs)
};
