import React from 'react';
import { PiRobot } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAssistantPanelStore } from '@/store/assistantPanelStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface AITogglerProps {
  bookKey: string;
}

const AIToggler: React.FC<AITogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isAssistantPanelVisible, toggleAssistantPanel } = useAssistantPanelStore();
  const iconSize18 = useResponsiveSize(18);

  const handleToggleAI = () => {
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
    if (sideBarBookKey === bookKey) {
      toggleAssistantPanel();
    } else {
      setSideBarBookKey(bookKey);
      if (!isAssistantPanelVisible) toggleAssistantPanel();
    }
  };
  return (
    <Button
      icon={<PiRobot size={iconSize18} className='text-base-content' />}
      onClick={handleToggleAI}
      label={_('AI')}
    ></Button>
  );
};

export default AIToggler;
