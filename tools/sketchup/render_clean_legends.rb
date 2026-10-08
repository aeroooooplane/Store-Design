# encoding: UTF-8
# Run only against the disposable legend seed. Never saves source models.
require 'json'
require 'fileutils'
module CleanPlanLegends
 ROOT='E:/效果图生成器/Store-Design'
 BASE=ROOT+'/素材库/04_assets/按SI标准命名-20261001'
 OUT=ROOT+'/tmp/clean-legends'
 SUPPORT={3=>'组件#16',4=>'组件#16',21=>'组#149',50=>'组#408',53=>'组#464',70=>'组#748',88=>'组#729',89=>'组#914'}
 def self.section(entities,t,z,segments,active=false,target=nil)
  entities.each do |e|
   next if e.hidden? || !e.layer.visible?
   if e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
    section(e.definition.entities,t*e.transformation,z,segments,active || e.definition.name==target,target)
   elsif active && e.is_a?(Sketchup::Face)
    points=[]
    e.edges.each do |edge|
     p=edge.start.position.transform(t);q=edge.end.position.transform(t)
     if (p.z-z)*(q.z-z)<0
      f=(z-p.z)/(q.z-p.z);points<<Geom::Point3d.new(p.x+(q.x-p.x)*f,p.y+(q.y-p.y)*f,z)
     end
    end
    segments<<points.first(2).map(&:to_a) if points.length==2 && points[0].distance(points[1])>0.01
   end
  end
 end
 def self.walk(entities, transform, bounds, groups, depth=0)
  entities.each do |e|
   next if e.hidden? || !e.layer.visible?
   if e.is_a?(Sketchup::Text) || e.is_a?(Sketchup::Dimension) || e.is_a?(Sketchup::ConstructionLine) || e.is_a?(Sketchup::ConstructionPoint)
    e.hidden=true
   elsif e.is_a?(Sketchup::Edge) && e.faces.empty?
    e.hidden=true
   elsif e.is_a?(Sketchup::Face)
    e.vertices.each{|v| p=v.position.transform(transform);bounds.add(p);@points<<p}
    e.edges.each do |edge|
     v=edge.end.position.transform(transform)-edge.start.position.transform(transform)
     if v.z.abs<0.001 && v.length>@longest
      @longest=v.length;@axis=v.normalize
     end
    end
   elsif e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
    if ['2.4AVBU','2.4insta360','2.4insta360+AVBU'].include?(e.definition.name) || (@asset_n==79 && ['组#640','组#702'].include?(e.definition.name))
     e.hidden=true;@omitted<<{definition:e.definition.name,reason:'verified extruded lettering'}
     next
    end
    t=transform*e.transformation
    child=Geom::BoundingBox.new
    walk(e.definition.entities,t,child,groups,depth+1)
    unless child.empty?
     # Furniture plans omit detachable demonstration products and raised lettering.
     # Keep the actual tabletop, pads and partitions, not invented replacements.
     if @simplify_island && ((child.min.z>=@table_top+1.5.mm) || (child.min.z>=@table_top-0.1.mm && child.max.z>@table_top+8.mm && child.width<450.mm && child.height<450.mm) || (child.min.z>=850.mm && child.width<=40.1.mm && child.height<=40.1.mm && child.depth<=40.1.mm) || ['组#487','组#906'].include?(e.definition.name))
      e.hidden=true
      @omitted<<{definition:e.definition.name,min:child.min.to_a,max:child.max.to_a}
      next
     end
     bounds.add(child.min,child.max)
     groups<<{name:e.name,definition:e.definition.name,depth:depth,min:child.min.to_a,max:child.max.to_a}
    end
   end
  end
 end
 def self.run
  FileUtils.mkdir_p(OUT)
  m=Sketchup.active_model
  raise 'Disposable seed required' unless m.path.end_with?('clean-legend-seed.skp')
  m.entities.clear!
  rows=JSON.parse(File.read(BASE+'/manifest.json'))['assets'].select{|a|a['plan_legend']}
  pilot=File.exist?(OUT+'/all.flag') ? nil : [50,53,88,89]
  rows.select!{|a|pilot.include?(a['n'])} if pilot
  if File.exist?(OUT+'/selection.json')
   selection=JSON.parse(File.read(OUT+'/selection.json'));rows.select!{|a|selection.include?(a['n'])}
  end
  results=[]
  if File.exist?(OUT+'/selection.json') && File.exist?(OUT+'/complete.json')
   ids=rows.map{|a|a['asset_id']}
   results=JSON.parse(File.read(OUT+'/complete.json')).reject{|r|ids.include?(r['id'])}
  end
  rows.each do |a|
   begin
    m.entities.clear!;m.definitions.purge_unused
    d=m.definitions.load(BASE+'/'+a['named_skp'])
    e=m.entities.add_instance(d,Geom::Transformation.new)
    @simplify_island=a['standard_name'].include?('中岛桌');@omitted=[];@asset_n=a['n']
    @table_top=a['material_si']=='SI1.0' ? 905.mm : 900.mm
    @longest=0.0;@axis=X_AXIS;@points=[]
    bounds=Geom::BoundingBox.new;groups=[]
    walk(m.entities,Geom::Transformation.new,bounds,groups)
    raise 'No visible faces' if bounds.empty?
    ro=m.rendering_options
    {'RenderMode'=>1,'BackgroundColor'=>Sketchup::Color.new(255,255,255),'DrawHorizon'=>false,'DrawGround'=>false,'DisplayColorByLayer'=>false,'DrawHidden'=>false,'DrawHiddenGeometry'=>false,'DrawHiddenObjects'=>false,'DrawSilhouettes'=>true,'SilhouetteWidth'=>2,'DrawLineEnds'=>false,'ExtendLines'=>false,'EdgeDisplayMode'=>1,'EdgeColorMode'=>1,'ForegroundColor'=>Sketchup::Color.new(0,0,0),'DisplaySectionPlanes'=>false,'DisplaySectionCuts'=>false,'DisplayFog'=>false,'DisplayText'=>false,'DisplayDims'=>false,'DisplayWatermarks'=>false,'DisplaySketchAxes'=>false}.each{|k,v|begin;ro[k]=v;rescue;end}
    File.write(OUT+'/rendering-options.json',JSON.pretty_generate(ro.to_h.transform_values{|v|v.to_s}))
    m.shadow_info['DisplayShadows']=false
    segments=[]
    if SUPPORT[a['n']]
     section(m.entities,Geom::Transformation.new,100.mm,segments,false,SUPPORT[a['n']])
     overlay=m.entities.add_group
     segments.each do |pair|
      p,q=pair.map{|v|Geom::Point3d.new(v[0],v[1],bounds.max.z+10.mm)}
      vec=q-p;len=vec.length;vec.normalize!;offset=0.0
      while offset<len
       overlay.entities.add_line(p.offset(vec,offset),p.offset(vec,[offset+18.mm,len].min))
       offset+=30.mm
      end
     end
    end
    c=bounds.center;r=[bounds.width,bounds.height,bounds.depth,1].max.to_f
    # Align the longest horizontal model edge, rather than a rotated world bbox.
    @axis.reverse! if @axis.x < -0.001 || (@axis.x.abs<0.001 && @axis.y<0)
    up=Z_AXIS.cross(@axis)
    xs=@points.map{|p|Geom::Vector3d.new(p.to_a).dot(@axis)}
    ys=@points.map{|p|Geom::Vector3d.new(p.to_a).dot(up)}
    c=Geom::Point3d.new(@axis.x*(xs.max+xs.min)/2+up.x*(ys.max+ys.min)/2,@axis.y*(xs.max+xs.min)/2+up.y*(ys.max+ys.min)/2,c.z)
    camera=Sketchup::Camera.new(c+Geom::Vector3d.new(0,0,r*3),c,up,false)
    camera.height=[ys.max-ys.min,(xs.max-xs.min)/1.5].max*1.16
    m.active_view.camera=camera
    m.active_view.refresh
    file=OUT+'/'+a['asset_id']+'.png'
    ok=m.active_view.write_image(filename:file,width:1200,height:800,antialias:true,transparent:true)
    m.active_view.write_image(filename:OUT+'/'+a['asset_id']+'-proof.png',width:1200,height:800,antialias:true,transparent:false)
    raise 'Image export failed' unless ok
    File.write(OUT+'/'+a['asset_id']+'-geometry.json',JSON.pretty_generate({bounds:[bounds.min.to_a,bounds.max.to_a],groups:groups,up:up.to_a,support_definition:SUPPORT[a['n']],support_section_z_mm:100,support_segments:segments,omitted_display_details:@omitted}))
    results<<{n:a['n'],id:a['asset_id'],status:'ok',file:file}
   rescue=>err
    results<<{n:a['n'],id:a['asset_id'],status:'error',error:err.full_message}
   end
   File.write(OUT+'/progress.json',JSON.pretty_generate(results))
   GC.start
  end
  m.entities.clear!
  File.write(OUT+'/complete.json',JSON.pretty_generate(results))
 rescue=>err
  File.write(OUT+'/error.txt',err.full_message)
 end
end
UI.start_timer(5,false){CleanPlanLegends.run}
