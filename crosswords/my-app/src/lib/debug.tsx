"use client"
import React, { useState } from "react";
import BugReportIcon from '@mui/icons-material/BugReport';
import { Box, Button, Modal, Typography } from "@mui/material";
// Simple debug icon (SVG)

type DebugButtonProps = {
    title?: string;
    data: any;
    alwaysShow?:boolean
};
const modalStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 1000,
  height: '80vh',
  overflowY: 'auto',
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
};
export const DebugButton: React.FC<DebugButtonProps> = ({ title, data, alwaysShow=false }) => {
    const [open, setOpen] = useState(false);
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);

    return (
        <>{process.env.NEXT_PUBLIC_INSTANCE_TYPE === 'dev' || process.env.NEXT_PUBLIC_INSTANCE_TYPE ==='test'}
            <Button
                variant="text"
                onClick={handleOpen}
                style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    display: "inline-flex",
                    alignItems: "center",
                }}
                title="Show debug data"
            >
                <BugReportIcon />{ title ? title : ""}
            </Button>
            <Modal
                open={open}
                onClose={handleClose}
                aria-labelledby="modal-modal-title"
                aria-describedby="modal-modal-description"
            >
                <Box sx={modalStyle}>
                    
                    <Typography id="modal-modal-title" variant="h6" component="h2">
                        { title ? title : "Debug"} Data
                    </Typography>
                    
                        <pre
                            style={{
                                margin: 0,
                                fontSize: 14,
                                lineHeight: 1.5,
     
                                padding: 12,
                                borderRadius: 4,
                                overflowX: "auto",
                            }}
                        >
                            {JSON.stringify(data, null, 2)}
                        </pre>
                   
                </Box>
            </Modal>
        </>
    );
};