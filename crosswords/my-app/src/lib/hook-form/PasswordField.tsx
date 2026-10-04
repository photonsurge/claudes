import { Box, FormControl, FormHelperText, IconButton, InputAdornment, InputLabel, OutlinedInput } from "@mui/material";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { useFormContext, Controller } from "react-hook-form"
import { fieldHolder } from "./general";
import { useState } from "react";
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

interface iTextFieldProps {
    label: string;
    id?: string;
    name: string;
    helperText: string;
    autoComplete?: boolean;
}


const PSPasswordField = ({ label, name, helperText, id, autoComplete }: iTextFieldProps) => {
    if(!id){
        id = `inpt_`+name;
    }
    const [showPassword, setShowPassword] = useState(false);
    const handleClickShowPassword = () => setShowPassword((show) => !show);

    const handleMouseDownPassword = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
    };

    const handleMouseUpPassword = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
    };

    const { control, formState: { errors }, } = useFormContext();

    const autoCompleteD = autoComplete ? "new-password" : "off";

    return <Controller
        name={name}
        control={control}
        render={(thing) => {


            const hText: string = (errors[name]?.message ? errors[name].message?.toString() : helperText);
            const error: boolean = (errors[name]?.message ? true : false)
            const textFieldProps: TextFieldProps = {
                value: thing.field.value ? thing.field.value : '',
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    thing.field.onChange(event.target.value);
                },

                error,
                label,
                helperText: hText
            }

            return <Box sx={{ ...fieldHolder }}>
                <FormControl sx={{  }} fullWidth variant="outlined" error={error}>
                    <InputLabel htmlFor={id}>{label}</InputLabel>
                    <OutlinedInput
                        id={id}
                        name={name}
                        fullWidth
                        label={label}
                        value={thing.field.value ? thing.field.value : ''}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            thing.field.onChange(event.target.value);
                        }}
                        autoComplete = { autoCompleteD }
                        type={showPassword ? 'text' : 'password'}
                        endAdornment={
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label={
                                        showPassword ? 'hide the password' : 'display the password'
                                    }
                                    onClick={handleClickShowPassword}
                                    onMouseDown={handleMouseDownPassword}
                                    onMouseUp={handleMouseUpPassword}
                                    edge="end"
                                >
                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        }

                    />
                     {hText && hText.length > 0 && <FormHelperText id="filled-weight-helper-text">{hText}</FormHelperText>}
                </FormControl>


            </Box>

        }}


    />
}


export default PSPasswordField;