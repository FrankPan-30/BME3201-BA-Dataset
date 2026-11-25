classdef ThreeIMUDashboard < handle
    % Three MPU-6050s; one row per sensor, fixed axis colors throughout.
    % BME3201_ThreeIMU.ino sends D,seq,frame_start_us,mask,18 raw values.
    properties (SetAccess = private)
        Figure
        Count = 0
        SensorCounts = zeros(1,3)
        BadLines = 0
        MissingFrames = 0
    end
    properties (Access = private)
        Device = []
        RenderTimer = []
        Clock
        Data = nan(30000,18)
        DeviceTimes = zeros(30000,1)
        HostTimes = zeros(30000,1)
        Sequences = zeros(30000,1)
        Masks = zeros(30000,1)
        Segments = zeros(30000,1)
        Segment = 1
        RawTime = -1
        WrapUS = 0
        TimeOffset = 0
        LastSequence = -1
        LastRx = -Inf
        SensorRx = [-Inf -Inf -Inf]
        Frozen = false
        Closing = false
        PortMenu
        ConnectButton
        FreezeButton
        WindowMenu
        StatusLabel
        InfoLabel
        SensorStatus
        SensorAccel
        SensorGyro
        SensorCountLabels
        Axes
        Lines
        PreferredPort = 'COM3'
        LastMessage = 'Raw data. Calibration pending.'
    end
    methods
        function app = ThreeIMUDashboard(port, autoConnect, visibility)
            if nargin<1, port='COM3'; end
            if nargin<2, autoConnect=true; end
            if nargin<3, visibility='on'; end
            app.PreferredPort=char(port);
            app.Clock=tic;
            app.buildUI(visibility);
            app.refreshPorts();
            app.RenderTimer=timer('ExecutionMode','fixedSpacing','Period',0.1, ...
                'BusyMode','drop','TimerFcn',@(~,~)app.render(), ...
                'ErrorFcn',@(~,~)app.renderError());
            start(app.RenderTimer);
            if autoConnect, app.connect(); end
        end

        function connect(app)
            if ~isempty(app.Device), app.disconnect(); return; end
            app.StatusLabel.Text='Connecting ...'; drawnow;
            candidate=[];
            try
                candidate=serialport(char(app.PortMenu.Value),115200,'Timeout',0.5);
                configureTerminator(candidate,'LF'); flush(candidate);
                app.Device=candidate;
                app.LastRx=-Inf; app.SensorRx(:)=-Inf;
                app.ConnectButton.Text='Disconnect'; app.PortMenu.Enable='off';
                app.LastMessage='Checking all three IMUs ...';
                configureCallback(candidate,'terminator',@(s,~)app.receive(s));
                % Recheck independently, including a module plugged in after boot.
                writeline(candidate,'R');
            catch err
                if ~isempty(candidate)
                    try, configureCallback(candidate,'off'); catch, end
                    try, delete(candidate); catch, end
                end
                app.Device=[];
                app.ConnectButton.Text='Connect'; app.PortMenu.Enable='on';
                app.LastMessage=['Connection failed. Check USB/port and close other serial viewers. ' err.message];
            end
        end

        function disconnect(app)
            device=app.Device; app.Device=[];
            if ~isempty(device)
                try, configureCallback(device,'off'); catch, end
                try, delete(device); catch, end
            end
            if ~app.Closing && isgraphics(app.Figure)
                app.ConnectButton.Text='Connect'; app.PortMenu.Enable='on';
                app.LastMessage='Disconnected. Recorded data is retained.';
            end
        end

        function state=getStatus(app)
            state=struct('Connected',~isempty(app.Device),'Frames',app.Count, ...
                'SensorSamples',app.SensorCounts,'InvalidLines',app.BadLines, ...
                'MissingFrames',app.MissingFrames,'LastMessage',app.LastMessage, ...
                'LatestMask',0,'Latest',nan(3,6));
            if app.Count>0
                state.LatestMask=app.Masks(app.Count);
                state.Latest=reshape(app.Data(app.Count,:),6,3)';
            end
        end

        function path=exportData(app,path)
            if nargin<2
                if app.Count==0
                    uialert(app.Figure,'No samples received yet.','Nothing to export');
                    path=''; return;
                end
                [file,folder]=uiputfile('*.csv','Export all three IMUs', ...
                    ['ThreeIMU_' char(datetime('now','Format','yyyyMMdd_HHmmss')) '.csv']);
                if isequal(file,0), path=''; return; end
                path=fullfile(folder,file);
            end
            n=app.Count;
            names={'segment','frame_sequence','device_time_s','host_time_s','valid_mask'};
            axesNames={'ax_g','ay_g','az_g','gx_deg_s','gy_deg_s','gz_deg_s'};
            for i=1:3
                for j=1:6, names{end+1}=sprintf('imu%d_%s',i,axesNames{j}); end %#ok<AGROW>
            end
            tableData=array2table([app.Segments(1:n),app.Sequences(1:n), ...
                app.DeviceTimes(1:n),app.HostTimes(1:n),app.Masks(1:n),app.Data(1:n,:)], ...
                'VariableNames',names);
            writetable(tableData,path);
            app.LastMessage=sprintf('Exported %d frames to %s',n,path);
        end

        function delete(app)
            if app.Closing, return; end
            app.Closing=true;
            if ~isempty(app.RenderTimer) && isvalid(app.RenderTimer)
                stop(app.RenderTimer); delete(app.RenderTimer);
            end
            app.disconnect();
            if ~isempty(app.Figure) && isgraphics(app.Figure)
                app.Figure.CloseRequestFcn=[]; delete(app.Figure);
            end
        end
    end
    methods (Static)
        function [values,ok,meta]=parseLine(line)
            values=[]; ok=false; meta=[];
            fields=split(strtrim(string(line)),',');
            if numel(fields)~=22 || fields(1)~="D", return; end
            nums=str2double(fields(2:end));
            if any(~isfinite(nums(1:3))) || any(nums(1:3)~=fix(nums(1:3))) ...
                    || any(nums(1:2)<0) || any(nums(1:2)>2^32-1) ...
                    || nums(3)<0 || nums(3)>7, return; end
            meta=nums(1:3)'; values=nums(4:end)';
            for i=1:3
                idx=(i-1)*6+(1:6);
                if bitget(uint8(meta(3)),i)
                    if any(~isfinite(values(idx))), values=[]; meta=[]; return; end
                else
                    % An invalid sensor must never appear as fresh valid zeros.
                    values(idx)=NaN;
                end
            end
            ok=true;
        end
    end
    methods (Access = private)
        function buildUI(app,visibility)
            ink=[0.13 0.18 0.25]; muted=[0.44 0.49 0.55];
            bg=[0.96 0.97 0.98]; colors=[0.15 0.46 0.76;0.91 0.45 0.20;0.49 0.39 0.69];
            app.Figure=uifigure('Name','BME3201 | Three IMUs', ...
                'Position',[60 45 1360 900],'Color',bg,'Visible',visibility, ...
                'CloseRequestFcn',@(~,~)delete(app));
            root=uigridlayout(app.Figure,[7 1]);
            root.RowHeight={44,38,22,'1x','1x','1x',22};
            root.Padding=[20 14 20 12]; root.RowSpacing=10; root.BackgroundColor=bg;
            head=uigridlayout(root,[1 2]); head.Padding=[0 0 0 0];
            head.ColumnWidth={'1x',480}; head.BackgroundColor=bg;
            uilabel(head,'Text','IMU / LIVE','FontSize',24,'FontWeight','bold','FontColor',ink);
            app.StatusLabel=uilabel(head,'Text','Not connected', ...
                'HorizontalAlignment','right','FontSize',13,'FontColor',muted);
            bar=uigridlayout(root,[1 11]); bar.Padding=[0 0 0 0];
            bar.ColumnWidth={34,92,70,106,112,'1x',32,32,32,76,108};
            bar.ColumnSpacing=8; bar.BackgroundColor=bg;
            uilabel(bar,'Text','Port','FontColor',muted);
            app.PortMenu=uidropdown(bar,'Items',{app.PreferredPort});
            uibutton(bar,'Text','Refresh','ButtonPushedFcn',@(~,~)app.refreshPorts());
            app.ConnectButton=uibutton(bar,'Text','Connect','FontColor',[1 1 1], ...
                'BackgroundColor',[0.13 0.43 0.70],'FontWeight','bold', ...
                'ButtonPushedFcn',@(~,~)app.connect());
            app.FreezeButton=uibutton(bar,'Text','Freeze plots', ...
                'ButtonPushedFcn',@(~,~)app.toggleFreeze());
            uilabel(bar,'Text','');
            for i=1:3
                uilabel(bar,'Text',char('X'+i-1),'FontColor',colors(i,:), ...
                    'FontWeight','bold','HorizontalAlignment','center');
            end
            app.WindowMenu=uidropdown(bar,'Items',{'10 s','20 s','60 s'},'Value','20 s');
            uibutton(bar,'Text','Export CSV','ButtonPushedFcn',@(~,~)app.exportData());
            headers=uigridlayout(root,[1 3]); headers.Padding=[14 0 14 0];
            headers.ColumnWidth={132,'1x','1x'}; headers.ColumnSpacing=12;
            headers.BackgroundColor=bg;
            for text={'SENSOR','ACCELERATION / g','ANGULAR VELOCITY / deg/s'}
                uilabel(headers,'Text',text{1},'FontWeight','bold','FontSize',11,'FontColor',muted);
            end
            app.SensorStatus=gobjects(1,3); app.SensorAccel=gobjects(1,3);
            app.SensorGyro=gobjects(1,3); app.SensorCountLabels=gobjects(1,3);
            app.Axes=gobjects(3,2); app.Lines=gobjects(3,2,3);
            wiring={'GPIO 1/2, address 0x68','GPIO 1/2, address 0x69','GPIO 4/5, address 0x68'};
            for i=1:3
                panel=uipanel(root,'BackgroundColor',[1 1 1],'BorderColor',[0.87 0.90 0.93]);
                row=uigridlayout(panel,[1 3]); row.Padding=[14 8 10 7];
                row.ColumnWidth={132,'1x','1x'}; row.ColumnSpacing=12;
                row.BackgroundColor=[1 1 1];
                info=uigridlayout(row,[6 1]); info.Padding=[0 7 0 0];
                info.RowHeight={30,24,23,23,22,'1x'}; info.RowSpacing=1;
                info.BackgroundColor=[1 1 1];
                uilabel(info,'Text',sprintf('IMU %d',i),'FontSize',21, ...
                    'FontWeight','bold','FontColor',ink,'Tooltip',wiring{i});
                app.SensorStatus(i)=uilabel(info,'Text','WAITING','FontSize',11,'FontWeight','bold','FontColor',muted);
                app.SensorAccel(i)=uilabel(info,'Text','|a|  -- g','FontSize',12,'FontColor',ink);
                app.SensorGyro(i)=uilabel(info,'Text','|w|  -- deg/s','FontSize',12,'FontColor',ink);
                app.SensorCountLabels(i)=uilabel(info,'Text','0 samples','FontSize',10,'FontColor',muted);
                for kind=1:2
                    ax=uiaxes(row,'FontSize',10,'Box','off', ...
                        'XColor',muted,'YColor',muted,'GridAlpha',0.10);
                    app.Axes(i,kind)=ax;
                    ax.XGrid='on'; ax.YGrid='on'; hold(ax,'on');
                    ax.Toolbar.Visible='off';
                    for axis=1:3
                        app.Lines(i,kind,axis)=plot(ax,nan,nan,'Color',colors(axis,:), ...
                            'LineWidth',1.25,'DisplayName',char('X'+axis-1));
                    end
                    xlim(ax,[0 20]);
                    if kind==1, ylim(ax,[-2.1 2.1]); else, ylim(ax,[-270 270]); end
                    if i==3, xlabel(ax,'Device frame time / s'); end
                end
            end
            app.InfoLabel=uilabel(root,'Text', ...
                'Raw / uncalibrated  |  Sequential reads  |  Freeze keeps recording', ...
                'FontSize',11,'FontColor',muted);
        end

        function refreshPorts(app)
            if ~isempty(app.Device), return; end
            try
                ports=cellstr(serialportlist('available')); ports=ports(:)';
                % Keep the known ESP32 selected, even if unplugged, rather than
                % silently attaching to an unrelated serial device.
                ports=unique([ports {app.PreferredPort}],'stable');
                app.PortMenu.Items=ports; app.PortMenu.Value=app.PreferredPort;
            catch err, app.LastMessage=['Port refresh failed: ' err.message]; end
        end

        function receive(app,source)
            if app.Closing || isempty(app.Device), return; end
            try
                line=strtrim(readline(source));
                [values,ok,meta]=ThreeIMUDashboard.parseLine(line);
                if ~ok
                    if startsWith(line,'#')
                        app.LastMessage=char(line);
                    elseif strlength(line)>0
                        app.BadLines=app.BadLines+1;
                    end
                    return;
                end
                n=app.Count+1; raw=meta(2);
                if app.RawTime<0
                    app.TimeOffset=-raw/1e6;
                elseif raw<app.RawTime
                    if app.RawTime-raw>2^31
                        app.WrapUS=app.WrapUS+2^32;
                    else
                        % MCU reboot: make a new export segment and keep the
                        % plotted timeline monotonic, without inventing sync.
                        app.Segment=app.Segment+1; app.WrapUS=0;
                        app.TimeOffset=app.DeviceTimes(app.Count)+0.02-raw/1e6;
                        app.LastSequence=-1;
                    end
                end
                if app.LastSequence>=0
                    gap=mod(meta(1)-app.LastSequence,2^32)-1;
                    if gap>0 && gap<100000, app.MissingFrames=app.MissingFrames+gap; end
                end
                if n>size(app.Data,1)
                    capacity=n+29999;
                    app.Data(capacity,18)=NaN; app.DeviceTimes(capacity)=0;
                    app.HostTimes(capacity)=0; app.Sequences(capacity)=0;
                    app.Masks(capacity)=0; app.Segments(capacity)=0;
                end
                now=toc(app.Clock);
                app.Data(n,:)=values;
                app.DeviceTimes(n)=(raw+app.WrapUS)/1e6+app.TimeOffset;
                app.HostTimes(n)=now; app.Sequences(n)=meta(1);
                app.Masks(n)=meta(3); app.Segments(n)=app.Segment;
                app.RawTime=raw; app.LastSequence=meta(1); app.LastRx=now;
                for i=1:3
                    if bitget(uint8(meta(3)),i)
                        app.SensorCounts(i)=app.SensorCounts(i)+1; app.SensorRx(i)=now;
                    end
                end
                app.Count=n;
            catch err
                app.disconnect();
                app.LastMessage=['Serial read failed. Reconnect USB and click Connect. ' err.message];
            end
        end

        function toggleFreeze(app)
            app.Frozen=~app.Frozen;
            if app.Frozen, app.FreezeButton.Text='Resume plots';
            else, app.FreezeButton.Text='Freeze plots'; end
        end

        function render(app)
            if app.Closing || ~isgraphics(app.Figure), return; end
            now=toc(app.Clock); n=app.Count; liveCount=0;
            connected=~isempty(app.Device);
            mask=0; if n>0, mask=app.Masks(n); end
            for i=1:3
                live=connected && now-app.SensorRx(i)<2 && bitget(uint8(mask),i);
                if live
                    liveCount=liveCount+1;
                    idx=(i-1)*6+(1:6); last=app.Data(n,idx);
                    app.SensorStatus(i).Text='LIVE';
                    app.SensorStatus(i).FontColor=[0.12 0.53 0.39];
                    app.SensorAccel(i).Text=sprintf('|a|  %.3f g',norm(last(1:3)));
                    app.SensorGyro(i).Text=sprintf('|w|  %.1f deg/s',norm(last(4:6)));
                else
                    if ~connected, label='DISCONNECTED';
                    elseif n==0, label='WAITING'; else, label='NO DATA'; end
                    app.SensorStatus(i).Text=label;
                    app.SensorStatus(i).FontColor=[0.77 0.42 0.12];
                    app.SensorAccel(i).Text='|a|  -- g';
                    app.SensorGyro(i).Text='|w|  -- deg/s';
                end
                app.SensorCountLabels(i).Text=sprintf('%d samples',app.SensorCounts(i));
            end
            rate=0;
            if n>1 && connected && now-app.LastRx<2
                recent=max(1,n-200):n;
                recent=recent(app.HostTimes(recent)>=app.HostTimes(n)-2);
                dt=app.HostTimes(n)-app.HostTimes(recent(1));
                if dt>0, rate=(numel(recent)-1)/dt; end
            end
            if connected
                app.StatusLabel.Text=sprintf('%s  /  %d of 3 live  /  %.0f frames/s', ...
                    char(app.PortMenu.Value),liveCount,rate);
            else, app.StatusLabel.Text='Disconnected / data retained'; end
            if liveCount==3, app.StatusLabel.FontColor=[0.12 0.53 0.39];
            else, app.StatusLabel.FontColor=[0.77 0.42 0.12]; end
            if connected && n>0 && liveCount<3
                app.InfoLabel.Text='Missing sensor data. Check that row''s power, SDA/SCL and AD0; reconnect to retry.';
            elseif app.MissingFrames>0
                app.InfoLabel.Text=sprintf('Raw / uncalibrated  |  %d frame gaps  |  Freeze keeps recording',app.MissingFrames);
            else
                app.InfoLabel.Text='Raw / uncalibrated  |  Sequential reads  |  Freeze keeps recording';
            end
            app.InfoLabel.Tooltip=app.LastMessage;
            if n>0 && ~app.Frozen
                window=sscanf(app.WindowMenu.Value,'%f');
                right=max(window,app.DeviceTimes(n));
                shown=max(1,n-12000):n;
                shown=shown(app.DeviceTimes(shown)>=right-window);
                t=app.DeviceTimes(shown);
                for i=1:3
                    for kind=1:2
                        for axis=1:3
                            col=(i-1)*6+(kind-1)*3+axis;
                            set(app.Lines(i,kind,axis),'XData',t,'YData',app.Data(shown,col));
                        end
                        xlim(app.Axes(i,kind),[right-window right]);
                    end
                end
            end
            drawnow limitrate;
        end

        function renderError(app)
            if ~app.Closing && isgraphics(app.Figure)
                app.InfoLabel.Text='Display update failed. Close the dashboard and run it again.';
            end
        end
    end
end
