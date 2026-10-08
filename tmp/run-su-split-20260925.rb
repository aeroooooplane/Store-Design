# encoding: UTF-8
# One-off task runner: reuse the project's verified selection exporter.
require 'json'
require 'fileutils'
load File.expand_path('../tools/sketchup/export_selected.rb', __dir__)
module StoreSplit20260925
  BASE = File.expand_path('../', __dir__)
  SOURCE = File.join(BASE, '道具模型', '影石通用模型.skp')
  OUTPUT = File.join(BASE, '素材库', '04_assets', 'incoming', 'split-20260925-v2')
  PLAN = File.join(BASE, 'tools', 'sketchup', 'exports', 'split-plan.json')
  def self.start
    @model = Sketchup.active_model
    raise 'Unexpected source model' unless File.expand_path(@model.path).downcase == SOURCE.downcase
    raise 'Exit edit mode' if @model.active_path
    raise 'Output already exists' if File.exist?(OUTPUT)
    FileUtils.mkdir_p(OUTPUT)
    @saved_selection = @model.selection.to_a
    @original_export_root = InstaAssetExport::ROOT
    @items = []; keys = {}
    plan = JSON.parse(File.read(PLAN))
    plan.select { |r| r['decision'] == 'export' }.each do |row|
      e = @model.find_entity_by_persistent_id(row['pid'])
      raise "Missing #{row['pid']}" unless e && e.parent == @model
      t = e.transformation
      shape = shape_key(t)
      handed = t.xaxis.cross(t.yaxis).dot(t.zaxis) < 0 ? -1 : 1
      key = [e.definition.guid, shape, handed, e.material ? e.material.entityID : nil]
      instance = {pid: e.persistent_id, transform: t.to_a, hidden: e.hidden?, layer: e.layer.name, world_bounds_m: row['bounds_m']}
      if keys[key]
        keys[key][:instances] << instance
      else
        item = {asset_id: "asset-#{e.persistent_id}", pid: e.persistent_id, category: row['category'], definition: e.definition.name, guid: e.definition.guid, instances: [instance], si_version: nil, status: 'queued', grouping: row['review_note']}
        @items << item; keys[key] = item
      end
    end
    @index = 0
    write_manifest('running')
    schedule
    puts "Batch started: #{@items.length} unique assets"
  end
  def self.shape_key(t)
    a=t.to_a
    columns=[a[0,3],a[4,3],a[8,3]]
    columns.flat_map{|x|columns.map{|y|x.zip(y).sum{|u,v|u*v}.round(8)}}
  end
  def self.write_manifest(status)
    File.write(File.join(OUTPUT,'manifest.json'),JSON.pretty_generate({source_model: SOURCE, source_sha256_before_batch: 'ded29dc7f6741972d5d630272bef92e996b6839a51e64bfe3a2ed1b5d513b943', sketchup_version: Sketchup.version, status: status, completed: @index, assets: @items, note: 'SKP is the native component definition. DAE preserves representative world transform. SI not inferred from colour. Assemblies retained intact; excluded source roots remain in split-plan.json.'}))
  end
  def self.schedule
    @timer = UI.start_timer(1.0, false) do
      UI.stop_timer(@timer)
      next if @busy
      if @index == 5 && !File.exist?(File.join(OUTPUT,'continue-after-pilot.flag'))
        write_manifest('pilot_ready')
      else
        step
      end
      schedule if @index < @items.length
    end
  end
  def self.step
    return if @busy
    @busy = true
    begin
    if @index >= @items.length
      UI.stop_timer(@timer)
      @model.selection.clear; @model.selection.add(@saved_selection)
      InstaAssetExport.send(:remove_const,:ROOT); InstaAssetExport.const_set(:ROOT,@original_export_root)
      write_manifest('export_complete')
      puts "Batch complete: #{@index} assets"
      return
    end
    item = @items[@index]
    begin
      e = @model.find_entity_by_persistent_id(item[:pid])
      @model.selection.clear; @model.selection.add(e)
      dir = File.join(OUTPUT,item[:asset_id])
      InstaAssetExport.send(:remove_const,:ROOT); InstaAssetExport.const_set(:ROOT,dir)
      InstaAssetExport.export_selected
      item[:folder] = Dir.glob(File.join(dir,'selected-*')).first.sub(OUTPUT+'/', '')
      e.definition.save_thumbnail(File.join(dir,'preview.png'))
      item[:status] = 'exported_pending_validation'
    rescue => ex
      item[:status]='failed'; item[:error]="#{ex.class}: #{ex.message}"
    end
    @index += 1
    if @index == @items.length
      @model.selection.clear; @model.selection.add(@saved_selection)
      InstaAssetExport.send(:remove_const,:ROOT); InstaAssetExport.const_set(:ROOT,@original_export_root)
    end
    write_manifest(@index == @items.length ? 'export_complete' : 'running')
    puts "#{@index}/#{@items.length}: #{item[:asset_id]} #{item[:status]}"
    ensure
      @busy = false
    end
  end
end
StoreSplit20260925.start
