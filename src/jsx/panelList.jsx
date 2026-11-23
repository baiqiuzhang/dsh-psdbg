var ref = new ActionReference();
ref.putProperty(charIDToTypeID('Prpr'), stringIDToTypeID('panelList'));
ref.putEnumerated(charIDToTypeID('capp'), charIDToTypeID('Ordn'), charIDToTypeID('Trgt'));
var desc = executeActionGet(ref);
var list = desc.getList(stringIDToTypeID('panelList'));
var panels = [];
for (var i = 0; i < list.count; i++) {
  var obj = list.getObjectValue(i);
  var item = {};
  try { item.name = obj.getString(stringIDToTypeID('name')); } catch (e) { item.name = null; }
  try { item.visible = obj.getBoolean(stringIDToTypeID('visible')); } catch (e) { item.visible = null; }
  try { item.id = obj.getString(stringIDToTypeID('ID')); } catch (e) { item.id = null; }
  panels.push(item);
}
return panels;
