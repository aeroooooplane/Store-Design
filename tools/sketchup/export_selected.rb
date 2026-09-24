# encoding: UTF-8
# Run in SketchUp 2022+ Ruby Console. Does not save/modify the source model.
require 'json'
require 'fileutils'
module InstaAssetExport
  ROOT = 'D:/text demo/素材库/04_assets'
  def self.inventory
    model = Sketchup.active_model
    FileUtils.mkdir_p(ROOT)
    rows = model.definitions.reject { |d| d.image? }.map do |d|
      b = d.bounds
      {name: d.name, guid: d.guid, instances: d.instances.length,
       local_bounds_m: [b.width, b.height, b.depth].map { |v| v.to_f * 0.0254 },
       axis_note: 'SketchUp X/Y/Z; bounds in definition coordinates, instance scaling excluded'}
    end
    File.write(File.join(ROOT, 'component-inventory.json'), JSON.pretty_generate(rows))
    puts "Indexed #{rows.length} component definitions."
  end
  def self.export_selected
    model = Sketchup.active_model
    selection = model.selection.to_a
    unless selection.length == 1 && (selection[0].is_a?(Sketchup::ComponentInstance) || selection[0].is_a?(Sketchup::Group))
      raise 'Select exactly one prop component/group at model root.'
    end
    raise 'Exit component editing before export.' if model.active_path
    entity = selection[0]
    folder = File.join(ROOT, "selected-#{Time.now.strftime('%Y%m%d-%H%M%S')}")
    raise 'Output exists; retry after one second.' if File.exist?(folder)
    FileUtils.mkdir_p(folder)
    raise 'SKP copy export failed.' unless entity.definition.save_copy(File.join(folder, 'prop.skp'))
    ok = model.export(File.join(folder, 'prop.dae'), {selectionset_only: true, triangulated_faces: true, texture_maps: true, edges: false, hidden_geometry: false, preserve_instancing: true})
    raise 'DAE export failed.' unless ok
    b = entity.bounds
    metadata = {source_model: model.path, definition: entity.definition.name, guid: entity.definition.guid,
      world_bounds_m: [b.width,b.height,b.depth].map { |v| v.to_f * 0.0254 },
      transform: entity.transformation.to_a, style: nil,
      status: 'exported; scale/orientation/materials require visual verification',
      note: 'World axis-aligned bounds include rotation. DAE may retain world placement. Normalize before GLB conversion.'}
    File.write(File.join(folder,'metadata.json'),JSON.pretty_generate(metadata))
    puts "Exported to #{folder}"
  end
end
puts 'Ready: InstaAssetExport.inventory ; InstaAssetExport.export_selected'
