# encoding: UTF-8
require 'json'
module SIReviewViews
 ROOT='E:/效果图生成器/Store-Design'
 BASE=ROOT+'/素材库/04_assets/incoming/split-20260925-v2'
 OUT=ROOT+'/tmp/si-standards-review/model-views'
 IDS=[568756,569180,666964,752992,2360478,3356988,24432224,24488377,24498456,28034994,28192911,33660153,33819654,34320268,36887885,36890994,36929122,36929204,37758059,958185,408124,16469753,41053706,41277543]
 def self.run
  m=Sketchup.active_model
  raise 'Need review seed' unless m.path.end_with?('review-seed.skp'); m.entities.clear!
  Dir.mkdir(OUT) unless Dir.exist?(OUT)
  rows=[]
  JSON.parse(File.read(BASE+'/manifest.json'))['assets'].select{|a|IDS.include?(a['pid'])}.each do |a|
   begin
    d=m.definitions.load(BASE+'/'+a['recommended_skp']); e=m.entities.add_instance(d,Geom::Transformation.new)
    b=e.bounds;c=b.center;r=[b.width,b.height,b.depth].max.to_f
    m.rendering_options['BackgroundColor']=Sketchup::Color.new(245,245,245)
    m.rendering_options['DrawHorizon']=false;m.rendering_options['DrawGround']=false
    m.rendering_options['DisplayColorByLayer']=false;m.rendering_options['RenderMode']=2
    [[1,-1,0.65],[-1,1,0.65],[0,-1,0.15],[1,0,0.15]].each_with_index do |v,i|
     eye=c+Geom::Vector3d.new(*v.map{|x|x*r*2})
     camera=Sketchup::Camera.new(eye,c,Z_AXIS,false); camera.height=r*1.45
     m.active_view.camera=camera
     m.active_view.write_image(filename:OUT+"/#{a['asset_id']}-#{i}.png",width:960,height:800,antialias:true,transparent:false)
    end
    e.erase!;m.definitions.purge_unused;m.materials.purge_unused;GC.start
    rows<<{id:a['asset_id'],status:'ok'}
   rescue=>err
    rows<<{id:a['asset_id'],status:'error',error:err.message}
   end
   File.write(OUT+'/progress.json',JSON.pretty_generate(rows))
  end
  File.write(OUT+'/complete.json',JSON.pretty_generate(rows))
 rescue=>err
  File.write(ROOT+'/tmp/si-standards-review/views-error.txt',err.full_message)
 end
end
SIReviewViews.run
